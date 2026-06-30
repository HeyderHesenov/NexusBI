"""RAG retrieval: ground Text2SQL with the user's own past queries + verified metrics.

Portable vector store — embeddings live in the ``query_embeddings`` table and
similarity is numpy cosine over a bounded, user-scoped candidate set. Retrieval
never crosses users (RLS-safe): a user only ever sees their own past queries plus
global verified metrics.
"""
from __future__ import annotations

import numpy as np
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai import client
from app.config import settings
from app.core import metrics
from app.core.logging import get_logger
from app.models.query_embedding import QueryEmbedding

_log = get_logger("nexusbi.rag")


async def _embed_one(text: str) -> list[float]:
    vecs = await client.embed([text])
    return vecs[0] if vecs else []


async def index_text(
    db: AsyncSession,
    *,
    user_id: str | None,
    datasource_id: str | None,
    kind: str,
    text: str,
    sql: str | None = None,
) -> None:
    """Embed + store one entry, skipping exact (user, kind, text) duplicates."""
    text = (text or "").strip()
    if not text:
        return
    exists = await db.execute(
        select(QueryEmbedding.id).where(
            QueryEmbedding.user_id == user_id,
            QueryEmbedding.kind == kind,
            QueryEmbedding.text == text,
        )
    )
    if exists.scalar_one_or_none() is not None:
        return
    vec = await _embed_one(text)
    if not vec:
        return
    db.add(
        QueryEmbedding(
            user_id=user_id, datasource_id=datasource_id, kind=kind,
            text=text, sql=sql, embedding=vec, dim=len(vec),
        )
    )
    await db.flush()


async def retrieve_context(
    db: AsyncSession, nl_query: str, user_id: str, datasource_id: str | None
) -> str:
    """Return a formatted few-shot block of the most similar prior queries + metrics.

    Empty string when RAG is disabled or nothing relevant is indexed.
    """
    if not settings.RAG_ENABLED:
        return ""
    qvec = np.array(await _embed_one(nl_query), dtype=float)
    qnorm = float(np.linalg.norm(qvec))
    if qvec.size == 0 or qnorm == 0:  # empty embed or token-less query → nothing to ground
        metrics.rag_retrievals_total.labels("miss").inc()
        return ""
    # Candidate scope: this user's entries (or global metrics), this datasource (or
    # datasource-agnostic metrics), most-recent first to bound the scan.
    rows = (
        await db.execute(
            select(QueryEmbedding)
            .where(
                or_(QueryEmbedding.user_id == user_id, QueryEmbedding.user_id.is_(None)),
                or_(
                    QueryEmbedding.datasource_id == datasource_id,
                    QueryEmbedding.datasource_id.is_(None),
                    QueryEmbedding.kind == "metric",
                ),
            )
            .order_by(QueryEmbedding.created_at.desc())
            .limit(settings.RAG_MAX_CANDIDATES)
        )
    ).scalars().all()

    scored: list[tuple[float, QueryEmbedding]] = []
    for r in rows:
        if r.dim != qvec.size:  # never compare mismatched embedding spaces
            continue
        cvec = np.array(r.embedding, dtype=float)
        denom = qnorm * float(np.linalg.norm(cvec))
        if denom == 0:
            continue
        scored.append((float(np.dot(qvec, cvec) / denom), r))

    if not scored:
        metrics.rag_retrievals_total.labels("miss").inc()
        return ""
    scored.sort(key=lambda s: s[0], reverse=True)
    top = [r for _score, r in scored[: settings.RAG_TOP_K]]
    metrics.rag_retrievals_total.labels("hit").inc()
    return _format(top)


def _format(rows: list[QueryEmbedding]) -> str:
    examples = [r for r in rows if r.kind == "query" and r.sql]
    metric_rows = [r for r in rows if r.kind == "metric"]
    parts: list[str] = []
    if examples:
        lines = "\n".join(f"Sual: {r.text}\nSQL: {r.sql}" for r in examples)
        parts.append("BƏNZƏR KEÇMİŞ SORĞULAR (nümunə kimi istifadə et, kor-koranə kopyalama):\n" + lines)
    if metric_rows:
        lines = "\n".join(f"- {r.text}" for r in metric_rows)
        parts.append("UYĞUN TƏSDİQLƏNMİŞ METRİKLƏR:\n" + lines)
    return "\n\n".join(parts)


# Canonical demo examples seeded globally (user_id=None) so demo queries are
# RAG-grounded from the first run. Idempotent (index_text dedups). These teach
# good aliasing/grouping; the eval bypasses RAG, so seeding can't inflate it.
_DEMO_SEED: list[tuple[str, str]] = [
    ("Regionlar üzrə satış payı",
     "SELECT region, SUM(revenue) AS total_revenue FROM sales GROUP BY region"),
    ("Aylıq gəlir trendi",
     "SELECT substr(sale_date, 1, 7) AS month, SUM(revenue) AS total_revenue "
     "FROM sales GROUP BY substr(sale_date, 1, 7) ORDER BY month"),
    ("Ən çox satan məhsullar",
     "SELECT product_name, SUM(revenue) AS total_revenue FROM sales "
     "GROUP BY product_name ORDER BY total_revenue DESC LIMIT 10"),
    ("Ölkə üzrə müştəri sayı",
     "SELECT country, COUNT(*) AS customer_count FROM customers GROUP BY country"),
]


async def seed_demo_examples(db: AsyncSession) -> int:
    """Seed global demo Q→SQL exemplars into the vector store (idempotent)."""
    seeded = 0
    for nl, sql in _DEMO_SEED:
        await index_text(db, user_id=None, datasource_id=None, kind="query", text=nl, sql=sql)
        seeded += 1
    return seeded


async def reindex(db: AsyncSession, user_id: str) -> int:
    """(Re)embed the user's recent successful queries + verified metrics. Returns count.

    Candidates are deduped in one query and embedded in a single batched call (not
    one network round-trip per item) so the request stays bounded even with a real
    embedding backend.
    """
    from app.models.metric import Metric
    from app.models.query_log import QueryLog

    # Collect candidate (user_id, datasource_id, kind, text, sql) tuples.
    candidates: list[tuple[str | None, str | None, str, str, str | None]] = []
    logs = (
        await db.execute(
            select(QueryLog)
            .where(QueryLog.user_id == user_id, QueryLog.generated_sql != "")
            .order_by(QueryLog.created_at.desc())
            .limit(settings.RAG_MAX_CANDIDATES)
        )
    ).scalars().all()
    for log in logs:
        rows = (log.result_data or {}).get("rows") if log.result_data else None
        if not rows:  # only index queries that actually returned data
            continue
        candidates.append((user_id, log.datasource_id, "query", log.natural_language.strip(), log.generated_sql))

    metrics_rows = (
        await db.execute(
            select(Metric).where(
                or_(Metric.user_id == user_id, Metric.user_id.is_(None)),
                Metric.verified.is_(True),
            )
        )
    ).scalars().all()
    for m in metrics_rows:
        text = (f"{m.name}: {m.expression}" if m.expression else m.name).strip()
        candidates.append((m.user_id, m.datasource_id, "metric", text, None))

    # Dedup against what's already indexed (one query) and within this batch.
    existing = {
        (uid, kind, text)
        for uid, kind, text in (
            await db.execute(
                select(QueryEmbedding.user_id, QueryEmbedding.kind, QueryEmbedding.text).where(
                    or_(QueryEmbedding.user_id == user_id, QueryEmbedding.user_id.is_(None))
                )
            )
        ).all()
    }
    fresh: list[tuple[str | None, str | None, str, str, str | None]] = []
    seen: set[tuple[str | None, str, str]] = set()
    for uid, ds_id, kind, text, sql in candidates:
        sig = (uid, kind, text)
        if not text or sig in existing or sig in seen:
            continue
        seen.add(sig)
        fresh.append((uid, ds_id, kind, text, sql))
    if not fresh:
        return 0

    vectors = await client.embed([c[3] for c in fresh])
    for (uid, ds_id, kind, text, sql), vec in zip(fresh, vectors):
        if not vec:
            continue
        db.add(
            QueryEmbedding(
                user_id=uid, datasource_id=ds_id, kind=kind,
                text=text, sql=sql, embedding=vec, dim=len(vec),
            )
        )
    await db.flush()
    return len(fresh)
