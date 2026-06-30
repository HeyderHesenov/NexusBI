"""Smart-insight notifications: turn notable data changes into Notifications."""
from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai import insight_digest
from app.core.logging import get_logger
from app.core.notification_types import NotificationCategory
from app.models.alert import Notification
from app.models.query_log import QueryLog
from app.models.saved_query import SavedQuery

_log = get_logger("nexusbi.insight")
_TITLE = "Smart Insight"
SCAN_LIMIT = 40  # how many recent logs to consider when scanning for insights


def rows_of(log: QueryLog | None) -> list[dict[str, Any]]:
    """Result rows of a query log, normalised to a list (never None)."""
    if log is None or not log.result_data:
        return []
    return log.result_data.get("rows") or []


async def scan_recent_distinct(
    db: AsyncSession, user_id: str, limit: int = SCAN_LIMIT
) -> list[tuple[str, list[dict[str, Any]]]]:
    """Recent DISTINCT non-empty queries as (nl_query, rows), newest first.

    Shared by smart-insight generation and the proactive digest so both scan
    history the same way (dedup by lowercased NL, skip empty result sets).
    """
    res = await db.execute(
        select(QueryLog)
        .where(QueryLog.user_id == user_id, QueryLog.result_data.is_not(None))
        .order_by(QueryLog.created_at.desc())
        .limit(limit)
    )
    seen: set[str] = set()
    out: list[tuple[str, list[dict[str, Any]]]] = []
    for log in res.scalars().all():
        nl = (log.natural_language or "").strip()
        if not nl or nl.lower() in seen:
            continue
        seen.add(nl.lower())
        rows = rows_of(log)
        if rows:
            out.append((nl, rows))
    return out


async def _record(db: AsyncSession, user_id: str, name: str, insight: str) -> None:
    db.add(
        Notification(
            user_id=user_id,
            alert_id=None,
            title=f"{_TITLE}: {name}"[:255],
            body=insight,
            category=NotificationCategory.INSIGHT,
        )
    )
    await db.flush()


async def from_saved_query_run(
    db: AsyncSession, sq: SavedQuery, prev_rows: list[dict[str, Any]], result
) -> None:
    """After a scheduled run, notify if the change vs the previous run is notable."""
    insight = await insight_digest.summarize_change(sq.nl_query, prev_rows, result.data)
    if insight:
        await _record(db, sq.user_id, sq.name, insight)


async def generate_for_user(db: AsyncSession, user_id: str, limit: int = 5) -> int:
    """On-demand: scan the user's recent distinct queries and emit notable insights.

    Uses already-stored result data (no query re-runs), one AI digest per query,
    capped at ``limit``. Returns the number of notifications created.
    """
    created = 0
    for nl, data in await scan_recent_distinct(db, user_id):
        if created >= limit:
            break
        insight = await insight_digest.summarize_change(nl, [], data)
        if insight:
            await _record(db, user_id, nl[:60], insight)
            created += 1
    return created
