"""SavedQuery lifecycle + scheduled-refresh helpers."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import SchemaNotFoundError
from app.models.saved_query import SavedQuery
from app.schemas.query import QueryResult
from app.services import query_service
from app.services.cache_service import CacheService

INTERVALS = {"hourly": 3600, "daily": 86400, "weekly": 604800}


def _aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


async def create(db: AsyncSession, user_id: str, payload) -> SavedQuery:
    sq = SavedQuery(
        user_id=user_id,
        name=payload.name,
        nl_query=payload.nl_query,
        datasource_id=payload.datasource_id,
        schedule=payload.schedule,
    )
    db.add(sq)
    await db.flush()
    await db.refresh(sq)
    return sq


async def list_for_user(db: AsyncSession, user_id: str) -> list[SavedQuery]:
    result = await db.execute(
        select(SavedQuery).where(SavedQuery.user_id == user_id).order_by(SavedQuery.created_at.desc())
    )
    return list(result.scalars().all())


async def get(db: AsyncSession, user_id: str, sq_id: str) -> SavedQuery:
    result = await db.execute(
        select(SavedQuery).where(SavedQuery.id == sq_id, SavedQuery.user_id == user_id)
    )
    sq = result.scalar_one_or_none()
    if sq is None:
        raise SchemaNotFoundError("Saxlanan sorğu tapılmadı.")
    return sq


async def update(db: AsyncSession, user_id: str, sq_id: str, payload) -> SavedQuery:
    sq = await get(db, user_id, sq_id)
    if payload.name is not None:
        sq.name = payload.name
    if payload.schedule is not None:
        sq.schedule = payload.schedule
    await db.flush()
    await db.refresh(sq)
    return sq


async def delete(db: AsyncSession, user_id: str, sq_id: str) -> None:
    sq = await get(db, user_id, sq_id)
    await db.delete(sq)
    await db.flush()


async def run(db: AsyncSession, cache: CacheService, sq: SavedQuery) -> QueryResult:
    """Execute the saved query, record the run, and evaluate its alerts."""
    from app.services import alert_service

    result = await query_service.process_nl_query(
        sq.nl_query, sq.datasource_id, sq.user_id, db, cache
    )
    sq.last_run_at = datetime.now(timezone.utc)
    sq.last_query_log_id = result.query_log_id
    await db.flush()
    await alert_service.check_saved_query(db, sq, result)
    return result


def is_due(sq: SavedQuery, now: datetime) -> bool:
    interval = INTERVALS.get(sq.schedule)
    if interval is None:
        return False
    last = _aware(sq.last_run_at)
    if last is None:
        return True
    return now - last >= timedelta(seconds=interval)


async def run_due(db: AsyncSession, cache: CacheService) -> int:
    """Run every scheduled query that is due (run() also evaluates alerts). Returns count."""
    now = datetime.now(timezone.utc)
    result = await db.execute(
        select(SavedQuery).where(SavedQuery.schedule != "off")
    )
    ran = 0
    for sq in result.scalars().all():
        if is_due(sq, now):
            await run(db, cache, sq)
            ran += 1
    return ran
