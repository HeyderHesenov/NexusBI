"""Smart-insight notifications: turn notable data changes into Notifications."""
from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai import insight_digest
from app.core.logging import get_logger
from app.models.alert import Notification
from app.models.query_log import QueryLog
from app.models.saved_query import SavedQuery

_log = get_logger("nexusbi.insight")
_TITLE = "Smart Insight"


def _rows(log: QueryLog | None) -> list[dict[str, Any]]:
    if log is None or not log.result_data:
        return []
    return log.result_data.get("rows", [])


async def _record(db: AsyncSession, user_id: str, name: str, insight: str) -> None:
    db.add(
        Notification(
            user_id=user_id,
            alert_id=None,
            title=f"{_TITLE}: {name}"[:255],
            body=insight,
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
    rows = await db.execute(
        select(QueryLog)
        .where(QueryLog.user_id == user_id, QueryLog.result_data.is_not(None))
        .order_by(QueryLog.created_at.desc())
        .limit(40)
    )
    seen: set[str] = set()
    created = 0
    for log in rows.scalars().all():
        if created >= limit:
            break
        nl = (log.natural_language or "").strip()
        if not nl or nl.lower() in seen:
            continue
        seen.add(nl.lower())
        data = _rows(log)
        if not data:
            continue
        insight = await insight_digest.summarize_change(nl, [], data)
        if insight:
            await _record(db, user_id, nl[:60], insight)
            created += 1
    return created
