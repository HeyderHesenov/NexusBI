"""Scheduled PDF/Excel report delivery — renders a saved query and emails it.

Mirrors ``digest_service.run_digests_due`` as a scheduler phase: each active
subscription has its own cadence (``last_sent_at`` + INTERVALS); rendering + email
are best-effort and per-subscription isolated so one failure can't sink the batch.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NexusBIException, SchemaNotFoundError
from app.core.logging import get_logger
from app.models.query_log import QueryLog
from app.models.report_subscription import ReportSubscription
from app.models.saved_query import SavedQuery
from app.services import integrations, report_renderer, saved_query_service
from app.services.cache_service import CacheService

_log = get_logger("nexusbi.reports")

_FORMATS = ("pdf", "xlsx")
_MAX_SUBS_PER_QUERY = 20  # cap recipients per saved query (each due tick can run its AI query)


def _aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _is_due(sub: ReportSubscription, now: datetime) -> bool:
    interval = saved_query_service.INTERVALS.get(sub.schedule)
    if interval is None:
        return False
    last = _aware(sub.last_sent_at)
    if last is None:
        return True
    return now - last >= timedelta(seconds=interval)


async def create_subscription(
    db: AsyncSession, user_id: str, saved_query_id: str, recipient: str, fmt: str, schedule: str
) -> ReportSubscription:
    # Ownership: the saved query must belong to the requester.
    await saved_query_service.get(db, user_id, saved_query_id)
    if fmt not in _FORMATS:
        raise SchemaNotFoundError("Naməlum format.")
    if schedule not in saved_query_service.INTERVALS:
        raise SchemaNotFoundError("Naməlum cədvəl.")
    count = await db.scalar(
        select(func.count())
        .select_from(ReportSubscription)
        .where(ReportSubscription.saved_query_id == saved_query_id)
    )
    if (count or 0) >= _MAX_SUBS_PER_QUERY:
        raise NexusBIException("Bu hesabat üçün çatdırılma limiti dolub.")
    sub = ReportSubscription(
        saved_query_id=saved_query_id, user_id=user_id,
        recipient=recipient, format=fmt, schedule=schedule,
    )
    db.add(sub)
    await db.flush()
    await db.refresh(sub)
    return sub


async def list_for_saved(db: AsyncSession, user_id: str, saved_query_id: str) -> list[ReportSubscription]:
    await saved_query_service.get(db, user_id, saved_query_id)  # ownership check
    result = await db.execute(
        select(ReportSubscription).where(
            ReportSubscription.saved_query_id == saved_query_id,
            ReportSubscription.user_id == user_id,
        )
    )
    return list(result.scalars().all())


async def delete_subscription(db: AsyncSession, user_id: str, sub_id: str) -> None:
    result = await db.execute(
        select(ReportSubscription).where(
            ReportSubscription.id == sub_id, ReportSubscription.user_id == user_id
        )
    )
    sub = result.scalar_one_or_none()
    if sub is None:
        raise SchemaNotFoundError("Abunəlik tapılmadı.")
    await db.delete(sub)
    await db.flush()


async def _load_data(
    db: AsyncSession, cache: CacheService, sq: SavedQuery
) -> tuple[list[str], list[dict]]:
    """Columns + rows for the report — reuse the last run if present, else run once."""
    if sq.last_query_log_id:
        log = await db.get(QueryLog, sq.last_query_log_id)
        if log and log.result_data:
            rd = log.result_data
            return rd.get("columns", []), rd.get("rows", [])
    result = await saved_query_service.run(db, cache, sq)
    return [c.name for c in result.columns], result.data


async def run_deliveries_due(db: AsyncSession, cache: CacheService) -> int:
    """Scheduler hook: render + email every subscription that is due. Returns count sent."""
    now = datetime.now(timezone.utc)
    subs = (
        await db.execute(select(ReportSubscription).where(ReportSubscription.active.is_(True)))
    ).scalars().all()
    sent = 0
    for sub in subs:
        if not _is_due(sub, now):
            continue
        # Advance the cadence UP FRONT so a failing subscription is retried at most
        # once per interval — never every tick (which would also re-run its AI query
        # via _load_data). A failed period is skipped, not hammered.
        sub.last_sent_at = now
        try:  # per-subscription isolation — one failure must not sink the batch
            sq = await db.get(SavedQuery, sub.saved_query_id)
            if sq is None:
                continue
            columns, rows = await _load_data(db, cache, sq)
            attachment = report_renderer.render(sub.format, sq.name, columns, rows)
            body = f"'{sq.name}' hesabatı əlavə olundu ({len(rows)} sətir)."
            ok = await integrations.deliver_report(
                sub.recipient, f"NexusBI — {sq.name}", body, attachment
            )
            if ok:
                sent += 1
            else:  # deliver_report swallows errors → False; don't count as sent
                _log.warning("report_delivery_unconfirmed", sub=sub.id)
        except Exception as exc:  # noqa: BLE001
            _log.warning("report_subscription_failed", sub=sub.id, error=str(exc)[:200])
    if sent:
        _log.info("reports_delivered", count=sent)
    return sent
