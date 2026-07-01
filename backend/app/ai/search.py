"""Global semantic search over a user's assets (dashboards, metrics, saved queries).

Reuses the portable vector store (``query_embeddings`` + ``client.embed`` + numpy
cosine), parallel to RAG ``retrieval`` but returning ranked asset hits instead of a
prompt block. Keyless-safe (hash embedding) so it works in demo/CI. Strictly
user-scoped — a user only ever searches their own assets.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai import client
from app.models.dashboard import Dashboard
from app.models.metric import Metric
from app.models.query_embedding import QueryEmbedding
from app.models.saved_query import SavedQuery

# Asset-search kinds — distinct from the RAG kinds "query" / "metric".
KIND_DASHBOARD = "dashboard"
KIND_METRIC = "metric_asset"
KIND_SAVED = "saved_query"
ASSET_KINDS = (KIND_DASHBOARD, KIND_METRIC, KIND_SAVED)

_MAX_HITS = 10


@dataclass
class SearchHit:
    kind: str
    ref_id: str
    title: str
    score: float


async def _collect_assets(db: AsyncSession, user_id: str) -> list[tuple[str, str, str, str]]:
    """(kind, ref_id, embed_text, display_title) for every searchable asset a user owns.

    ``embed_text`` includes description/synonyms for recall; ``display_title`` is the
    bare name shown in the results palette.
    """
    out: list[tuple[str, str, str, str]] = []

    for d in (await db.execute(select(Dashboard).where(Dashboard.user_id == user_id))).scalars().all():
        text = " ".join(p for p in (d.name, d.description) if p).strip()
        if text:
            out.append((KIND_DASHBOARD, d.id, text, d.name))

    for m in (await db.execute(select(Metric).where(Metric.user_id == user_id))).scalars().all():
        text = " ".join(p for p in (m.name, m.description, m.synonyms) if p).strip()
        if text:
            out.append((KIND_METRIC, m.id, text, m.name))

    for s in (await db.execute(select(SavedQuery).where(SavedQuery.user_id == user_id))).scalars().all():
        text = " ".join(p for p in (s.name, s.nl_query) if p).strip()
        if text:
            out.append((KIND_SAVED, s.id, text, s.name))

    return out


async def index_assets(db: AsyncSession, user_id: str) -> int:
    """(Re)embed the user's assets — upsert on text change. Returns embedded count.

    Only new or changed assets are re-embedded (single batched call), so repeat
    indexing is a no-op when nothing changed. The display title is stored in the
    reused ``sql`` column (unused for asset entries).
    """
    assets = await _collect_assets(db, user_id)
    current_keys = {(kind, ref_id) for kind, ref_id, _text, _title in assets}

    # Load existing asset embeddings; collapse accidental duplicates (e.g. from a
    # concurrent first-search bootstrap) to one row per (kind, ref_id).
    existing: dict[tuple[str, str | None], QueryEmbedding] = {}
    for e in (
        await db.execute(
            select(QueryEmbedding).where(
                QueryEmbedding.user_id == user_id,
                QueryEmbedding.kind.in_(ASSET_KINDS),
            )
        )
    ).scalars().all():
        key = (e.kind, e.ref_id)
        if key in existing:
            await db.delete(e)  # duplicate
        else:
            existing[key] = e

    # Prune embeddings for assets that no longer exist (deleted dashboards/metrics/…)
    # so search never points at a dead ref_id.
    for key, row in list(existing.items()):
        if key not in current_keys:
            await db.delete(row)
            del existing[key]

    to_embed: list[tuple[str, str, str, str, QueryEmbedding | None]] = []
    for kind, ref_id, text, title in assets:
        row = existing.get((kind, ref_id))
        if row is None or row.text != text or row.sql != title:
            to_embed.append((kind, ref_id, text, title, row))
    if not to_embed:
        await db.flush()  # persist any dup/orphan deletions above
        return 0

    vectors = await client.embed([t[2] for t in to_embed])
    for (kind, ref_id, text, title, row), vec in zip(to_embed, vectors):
        if not vec:
            continue
        if row is not None:
            row.text, row.sql, row.embedding, row.dim = text, title, vec, len(vec)
        else:
            db.add(
                QueryEmbedding(
                    user_id=user_id, datasource_id=None, kind=kind, ref_id=ref_id,
                    text=text, sql=title, embedding=vec, dim=len(vec),
                )
            )
    await db.flush()
    return len(to_embed)


async def search_assets(
    db: AsyncSession, query: str, user_id: str, *, limit: int = _MAX_HITS
) -> list[SearchHit]:
    """Rank the user's assets by cosine similarity to ``query``."""
    query = (query or "").strip()
    if not query:
        return []

    # Bootstrap: index on the first-ever search so results exist without a manual reindex.
    have = await db.scalar(
        select(QueryEmbedding.id)
        .where(QueryEmbedding.user_id == user_id, QueryEmbedding.kind.in_(ASSET_KINDS))
        .limit(1)
    )
    if have is None:
        await index_assets(db, user_id)

    embedded = await client.embed([query])
    qvec = np.array(embedded[0] if embedded else [], dtype=float)
    qnorm = float(np.linalg.norm(qvec))
    if qvec.size == 0 or qnorm == 0:
        return []

    rows = (
        await db.execute(
            select(QueryEmbedding).where(
                QueryEmbedding.user_id == user_id,
                QueryEmbedding.kind.in_(ASSET_KINDS),
            )
        )
    ).scalars().all()

    hits: list[SearchHit] = []
    for r in rows:
        if r.dim != qvec.size or not r.ref_id:  # skip mismatched spaces / legacy rows
            continue
        cvec = np.array(r.embedding, dtype=float)
        denom = qnorm * float(np.linalg.norm(cvec))
        if denom == 0:
            continue
        hits.append(
            SearchHit(
                kind=r.kind, ref_id=r.ref_id, title=r.sql or r.text,
                score=float(np.dot(qvec, cvec) / denom),
            )
        )
    hits.sort(key=lambda h: h.score, reverse=True)
    # Collapse any duplicate (kind, ref_id) rows to the best-scoring hit.
    seen: set[tuple[str, str]] = set()
    deduped: list[SearchHit] = []
    for h in hits:
        key = (h.kind, h.ref_id)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(h)
    return deduped[:limit]
