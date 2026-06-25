"""Metric (semantic layer) CRUD + prompt formatting."""
from __future__ import annotations

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import SchemaNotFoundError
from app.models.metric import Metric


async def create(db: AsyncSession, user_id: str, payload) -> Metric:
    metric = Metric(
        user_id=user_id,
        datasource_id=payload.datasource_id,
        name=payload.name,
        expression=payload.expression,
        description=payload.description,
        synonyms=payload.synonyms,
    )
    db.add(metric)
    await db.flush()
    await db.refresh(metric)
    return metric


async def list_for(
    db: AsyncSession, user_id: str, datasource_id: str | None = None
) -> list[Metric]:
    """Metrics for this datasource plus the user's global (null-datasource) ones."""
    stmt = select(Metric).where(Metric.user_id == user_id)
    if datasource_id:
        stmt = stmt.where(
            or_(Metric.datasource_id == datasource_id, Metric.datasource_id.is_(None))
        )
    else:
        stmt = stmt.where(Metric.datasource_id.is_(None))
    result = await db.execute(stmt.order_by(Metric.created_at.desc()))
    return list(result.scalars().all())


async def delete(db: AsyncSession, user_id: str, metric_id: str) -> None:
    result = await db.execute(
        select(Metric).where(Metric.id == metric_id, Metric.user_id == user_id)
    )
    metric = result.scalar_one_or_none()
    if metric is None:
        raise SchemaNotFoundError("Metrik tapılmadı.")
    await db.delete(metric)
    await db.flush()


def metrics_as_prompt(metrics: list[Metric]) -> str:
    """Render metric definitions as a compact prompt block (empty if none)."""
    if not metrics:
        return ""
    lines = ["BİZNES METRİKLƏRİ (tərif və sinonimlər — sorğuda istifadə et):"]
    for m in metrics:
        parts = [f"- {m.name}"]
        if m.expression:
            parts.append(f"= {m.expression}")
        if m.synonyms:
            parts.append(f"(sinonimlər: {m.synonyms})")
        if m.description:
            parts.append(f"— {m.description}")
        lines.append(" ".join(parts))
    return "\n".join(lines)
