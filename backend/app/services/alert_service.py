"""Alert (monitor) evaluation + notifications."""
from __future__ import annotations

import operator as _op
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import SchemaNotFoundError
from app.models.alert import Alert, Notification
from app.models.saved_query import SavedQuery
from app.schemas.query import QueryResult

_OPS = {
    ">": _op.gt, "<": _op.lt, ">=": _op.ge, "<=": _op.le, "==": _op.eq, "!=": _op.ne,
}


async def create(db: AsyncSession, user_id: str, payload) -> Alert:
    # Ownership check: the saved query must belong to this user.
    owned = await db.execute(
        select(SavedQuery.id).where(
            SavedQuery.id == payload.saved_query_id, SavedQuery.user_id == user_id
        )
    )
    if owned.scalar_one_or_none() is None:
        raise SchemaNotFoundError("Saxlanan sorğu tapılmadı.")
    alert = Alert(
        user_id=user_id,
        saved_query_id=payload.saved_query_id,
        name=payload.name,
        column=payload.column,
        operator=payload.operator,
        threshold=payload.threshold,
    )
    db.add(alert)
    await db.flush()
    await db.refresh(alert)
    return alert


async def list_for_user(db: AsyncSession, user_id: str) -> list[Alert]:
    result = await db.execute(
        select(Alert).where(Alert.user_id == user_id).order_by(Alert.created_at.desc())
    )
    return list(result.scalars().all())


async def delete(db: AsyncSession, user_id: str, alert_id: str) -> None:
    result = await db.execute(
        select(Alert).where(Alert.id == alert_id, Alert.user_id == user_id)
    )
    alert = result.scalar_one_or_none()
    if alert is None:
        raise SchemaNotFoundError("Alert tapılmadı.")
    await db.delete(alert)
    await db.flush()


def evaluate(alert: Alert, rows: list[dict[str, Any]]) -> bool:
    """True if any row's column value satisfies the alert condition."""
    fn = _OPS.get(alert.operator)
    if fn is None:
        return False
    for row in rows:
        raw = row.get(alert.column)
        if raw is None:
            continue
        try:
            if fn(float(raw), alert.threshold):
                return True
        except (TypeError, ValueError):
            continue
    return False


async def check_saved_query(db: AsyncSession, sq: SavedQuery, result: QueryResult) -> int:
    """Evaluate active alerts on a saved query; create notifications on breach."""
    rows = result.data
    res = await db.execute(
        select(Alert).where(Alert.saved_query_id == sq.id, Alert.active.is_(True))
    )
    fired = 0
    for alert in res.scalars().all():
        if evaluate(alert, rows):
            alert.last_triggered_at = datetime.now(timezone.utc)
            db.add(
                Notification(
                    user_id=alert.user_id,
                    alert_id=alert.id,
                    title=f"Alert: {alert.name}",
                    body=(
                        f"“{sq.name}” sorğusunda {alert.column} {alert.operator} "
                        f"{alert.threshold} şərti pozuldu."
                    ),
                )
            )
            fired += 1
    if fired:
        await db.flush()
    return fired


# ─── Notifications ───

async def list_notifications(db: AsyncSession, user_id: str, limit: int = 50) -> list[Notification]:
    result = await db.execute(
        select(Notification)
        .where(Notification.user_id == user_id)
        .order_by(Notification.read, Notification.created_at.desc())
        .limit(limit)
    )
    return list(result.scalars().all())


async def mark_read(db: AsyncSession, user_id: str, notif_id: str) -> None:
    result = await db.execute(
        select(Notification).where(
            Notification.id == notif_id, Notification.user_id == user_id
        )
    )
    n = result.scalar_one_or_none()
    if n is not None:
        n.read = True
        await db.flush()


async def mark_all_read(db: AsyncSession, user_id: str) -> None:
    result = await db.execute(
        select(Notification).where(
            Notification.user_id == user_id, Notification.read.is_(False)
        )
    )
    for n in result.scalars().all():
        n.read = True
    await db.flush()
