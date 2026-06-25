"""Decision (Insight → Action → Outcome) CRUD."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import SchemaNotFoundError
from app.models.decision import Decision


async def create(db: AsyncSession, user_id: str, payload) -> Decision:
    d = Decision(
        user_id=user_id,
        title=payload.title,
        insight=payload.insight,
        action=payload.action,
        query_log_id=payload.query_log_id,
    )
    db.add(d)
    await db.flush()
    await db.refresh(d)
    return d


async def list_for_user(db: AsyncSession, user_id: str) -> list[Decision]:
    result = await db.execute(
        select(Decision).where(Decision.user_id == user_id).order_by(Decision.created_at.desc())
    )
    return list(result.scalars().all())


async def get(db: AsyncSession, user_id: str, decision_id: str) -> Decision:
    result = await db.execute(
        select(Decision).where(Decision.id == decision_id, Decision.user_id == user_id)
    )
    d = result.scalar_one_or_none()
    if d is None:
        raise SchemaNotFoundError("Qərar tapılmadı.")
    return d


async def update(db: AsyncSession, user_id: str, decision_id: str, payload) -> Decision:
    d = await get(db, user_id, decision_id)
    for field in ("title", "action", "status", "outcome"):
        value = getattr(payload, field)
        if value is not None:
            setattr(d, field, value)
    await db.flush()
    await db.refresh(d)
    return d


async def delete(db: AsyncSession, user_id: str, decision_id: str) -> None:
    d = await get(db, user_id, decision_id)
    await db.delete(d)
    await db.flush()
