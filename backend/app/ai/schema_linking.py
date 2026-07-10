"""Schema linking for Text2SQL — send the model only the tables a question needs.

On a wide database (dozens of tables) dumping the WHOLE schema into the prompt
both bloats the context and invites wrong-table joins. Instead we embed a compact
per-table descriptor (name + columns + FK references), rank tables by cosine
similarity to the question, keep the top-K, and pull in FK-connected tables so a
join still has both sides in context. Small schemas skip all of this (full context
is better and cheaper than a lossy subset).

Best-effort, never lossy at the DB layer: the subset only shapes GENERATION. The
row-level guard/allowlist still runs on the FULL schema, and the self-repair loop
re-generates on the FULL schema — so a table the ranking dropped is recovered the
moment its absence makes the SQL fail (see query_service._live_pipeline).

SECURITY: a descriptor is METADATA ONLY — never a sampled cell value. Descriptors
are embedded and the vectors cached under a key shared across viewers, so embedding
real values would leak RLS-protected rows into other viewers' prompts (the
2026-07-06 row-sampling removal). A regression test asserts sample values never
reach a descriptor.
"""
from __future__ import annotations

import hashlib
from typing import Any

import numpy as np

from app.ai import client
from app.ai.schema_introspector import format_schema_for_prompt
from app.config import settings
from app.core.logging import get_logger
from app.services.cache_service import CacheService

_log = get_logger("nexusbi.schema_link")


def _descriptor(table: str, columns: list[Any]) -> str:
    """Compact metadata line for a table: name + each column's name/type and FK
    reference. NEVER includes sampled values (tenant-leak safety)."""
    parts = [table]
    for c in columns or []:
        if isinstance(c, dict):
            piece = f"{c.get('name', '')} {c.get('type', '')}".strip()
            ref = c.get("references")
            if ref:
                piece = f"{piece} -> {ref}"
            parts.append(piece)
        else:
            parts.append(str(c))
    return " | ".join(parts)


def table_descriptors(schema: dict[str, Any]) -> dict[str, str]:
    """{table: descriptor} for every table — metadata only, no sample values."""
    return {t: _descriptor(t, cols) for t, cols in schema.items()}


def _fk_closure(
    selected: set[str], schema: dict[str, Any], *, max_tables: int | None = None
) -> set[str]:
    """Expand ``selected`` with FK-connected tables so an emitted join has BOTH sides
    in context. OUTBOUND targets (a selected table's ``references``) are always added —
    the model will name them. INBOUND sources (a table that references a selected
    table, e.g. a fact pointing at a chosen dimension) are added best-effort up to
    ``max_tables`` so a hub dimension referenced by many facts can't balloon the
    prompt back to full size. One hop only; the repair loop re-runs on the FULL
    schema, covering deeper (multi-hop) joins."""
    out = set(selected)
    # Outbound: bounded by each table's own FK count, so always safe to include.
    for t in list(out):
        for c in schema.get(t, []):
            ref = c.get("references") if isinstance(c, dict) else None
            if ref:
                ref_table = str(ref).split(".", 1)[0]
                if ref_table in schema:
                    out.add(ref_table)
    # Inbound: best-effort, capped so a densely-referenced hub can't pull the world in.
    cap = max_tables if max_tables is not None else len(schema)
    for t, cols in schema.items():
        if len(out) >= cap:
            break
        if t in out:
            continue
        for c in cols:
            ref = c.get("references") if isinstance(c, dict) else None
            if ref and str(ref).split(".", 1)[0] in out:
                out.add(t)
                break
    return out


def _render_subset(schema: dict[str, Any], selected: set[str]) -> str:
    """Render only the selected tables (original order). Drop any FK ``references``
    pointing OUTSIDE the subset so the model never sees a ``-> hidden_table`` pointer
    it can't join to — a dangling pointer invites a hallucinated join to an absent
    table."""
    subset: dict[str, Any] = {}
    for t, cols in schema.items():
        if t not in selected:
            continue
        new_cols: list[Any] = []
        for c in cols:
            if isinstance(c, dict) and c.get("references"):
                ref_table = str(c["references"]).split(".", 1)[0]
                if ref_table not in selected:
                    c = {k: v for k, v in c.items() if k != "references"}
            new_cols.append(c)
        subset[t] = new_cols
    return format_schema_for_prompt(subset)


async def _descriptor_embeddings(
    descriptors: dict[str, str], cache: CacheService | None
) -> dict[str, list[float]] | None:
    """Embed each table descriptor (one batched call), cached by a hash of the
    descriptor text so a stable schema is embedded once. The active embedding
    model/dimension is folded into the key so a model swap can't serve stale-dimension
    vectors. None on embed failure."""
    tables = list(descriptors)
    joined = "\n".join(f"{t}::{descriptors[t]}" for t in tables)
    # Model + hash-dim in the key: changing either invalidates the cache instead of
    # returning old-dimension vectors that would mismatch a fresh query embedding.
    sig = f"{settings.EMBEDDING_MODEL}|{settings.RAG_HASH_DIM}"
    key = "schemalink:" + hashlib.sha1((sig + "\n" + joined).encode()).hexdigest()
    if cache is not None:
        hit = await cache.get(key)
        if isinstance(hit, dict) and all(t in hit for t in tables):
            return hit
    vectors = await client.embed([descriptors[t] for t in tables])
    if len(vectors) != len(tables):
        return None
    out = {t: vectors[i] for i, t in enumerate(tables)}
    if cache is not None:
        await cache.set(key, out, ttl=settings.SCHEMA_LINK_CACHE_TTL_SECONDS)
    return out


async def select_relevant(
    nl_query: str, schema: dict[str, Any], cache: CacheService | None = None
) -> str:
    """Render only the tables relevant to ``nl_query`` (+ their FK-connected tables)
    as prompt text. Fail-OPEN: a schema at/below ``SCHEMA_LINK_MIN_TABLES``, any
    embedding error, or an embedding-dimension mismatch returns the FULL schema —
    linking must never lose a table the query needs on a technicality."""
    tables = list(schema.keys())
    if len(tables) <= settings.SCHEMA_LINK_MIN_TABLES:
        return format_schema_for_prompt(schema)
    try:
        descriptors = table_descriptors(schema)
        table_vecs = await _descriptor_embeddings(descriptors, cache)
        if table_vecs is None:
            return format_schema_for_prompt(schema)
        qvec = np.asarray((await client.embed([nl_query]))[0], dtype=float)
        qnorm = float(np.linalg.norm(qvec))
        # Score each table once (query norm hoisted). If descriptor and query vectors
        # disagree on dimension — e.g. one served from a real-model cache, the other a
        # keyless hash fallback — ranking is meaningless, so fail open to the full
        # schema rather than emit a garbage subset (and rather than let np.dot raise).
        scores: dict[str, float] = {}
        for t in tables:
            tv = np.asarray(table_vecs[t], dtype=float)
            if tv.shape != qvec.shape:
                _log.warning("schema_link_dim_mismatch", table=t)
                return format_schema_for_prompt(schema)
            denom = qnorm * float(np.linalg.norm(tv))
            scores[t] = float(np.dot(qvec, tv) / denom) if denom else 0.0
        ranked = sorted(tables, key=lambda t: scores[t], reverse=True)
        selected = _fk_closure(
            set(ranked[: settings.SCHEMA_LINK_TOP_K]),
            schema,
            max_tables=settings.SCHEMA_LINK_TOP_K * 2,
        )
    except Exception as exc:  # noqa: BLE001 — never let linking break generation
        _log.warning("schema_link_failed", error=str(exc)[:200])
        return format_schema_for_prompt(schema)
    return _render_subset(schema, selected)
