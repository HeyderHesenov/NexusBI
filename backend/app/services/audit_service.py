"""Append-only audit trail of security-relevant user actions."""
from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.workspace import AuditLog


async def log(
    db: AsyncSession,
    user_id: str,
    action: str,
    *,
    entity: str = "",
    entity_id: str | None = None,
    meta: dict[str, Any] | None = None,
) -> None:
    """Record an action. Best-effort: never raise into the calling request."""
    db.add(
        AuditLog(
            user_id=user_id, action=action, entity=entity, entity_id=entity_id, meta=meta
        )
    )
    await db.flush()


async def list_for_user(db: AsyncSession, user_id: str, limit: int = 100) -> list[AuditLog]:
    res = await db.execute(
        select(AuditLog)
        .where(AuditLog.user_id == user_id)
        .order_by(AuditLog.created_at.desc())
        .limit(limit)
    )
    return list(res.scalars().all())
