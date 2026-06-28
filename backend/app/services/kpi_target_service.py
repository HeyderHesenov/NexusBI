"""KPITarget CRUD + pacing assembly."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import SchemaNotFoundError
from app.models.kpi_target import KPITarget
from app.schemas.scenario import KPITargetResponse, Pacing
from app.services import scenario_service


def to_response(t: KPITarget) -> KPITargetResponse:
    pacing = scenario_service.pacing(
        t.target_value, t.current_value, t.period, t.period_start
    )
    return KPITargetResponse(
        id=t.id,
        name=t.name,
        target_value=t.target_value,
        current_value=t.current_value,
        period=t.period,
        period_start=t.period_start,
        created_at=t.created_at,
        pacing=Pacing(**pacing),
    )


async def create(db: AsyncSession, user_id: str, payload) -> KPITarget:
    t = KPITarget(
        user_id=user_id,
        name=payload.name,
        target_value=payload.target_value,
        current_value=payload.current_value,
        period=payload.period,
        period_start=payload.period_start,
    )
    db.add(t)
    await db.flush()
    await db.refresh(t)
    return t


async def list_for_user(db: AsyncSession, user_id: str) -> list[KPITarget]:
    res = await db.execute(
        select(KPITarget)
        .where(KPITarget.user_id == user_id)
        .order_by(KPITarget.created_at.desc())
    )
    return list(res.scalars().all())


async def get(db: AsyncSession, user_id: str, target_id: str) -> KPITarget:
    res = await db.execute(
        select(KPITarget).where(KPITarget.id == target_id, KPITarget.user_id == user_id)
    )
    t = res.scalar_one_or_none()
    if t is None:
        raise SchemaNotFoundError("KPI hədəfi tapılmadı.")
    return t


async def update(db: AsyncSession, user_id: str, target_id: str, payload) -> KPITarget:
    t = await get(db, user_id, target_id)
    for field in ("name", "target_value", "current_value", "period", "period_start"):
        value = getattr(payload, field, None)
        if value is not None:
            setattr(t, field, value)
    await db.flush()
    await db.refresh(t)
    return t


async def delete(db: AsyncSession, user_id: str, target_id: str) -> None:
    t = await get(db, user_id, target_id)
    await db.delete(t)
    await db.flush()
