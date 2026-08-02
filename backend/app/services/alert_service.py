"""Alert (monitor) evaluation + notifications."""
from __future__ import annotations

import operator as _op
from datetime import date, datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import SchemaNotFoundError
from app.core.notification_types import NotificationCategory
from app.core.timeutil import aware
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
        condition_type=payload.condition_type,
        operator=payload.operator,
        threshold=payload.threshold,
        cooldown_minutes=payload.cooldown_minutes,
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
    """True if the alert condition fires on the current result.

    "static" → any row's column satisfies operator/threshold. "anomaly" → the LATEST
    point of the column series is a MAD z-score outlier (dynamic threshold, no constant).
    Result sets are snapshot-bounded (<=1000 rows) upstream, so this stays cheap.
    """
    if alert.condition_type == "anomaly":
        return _evaluate_anomaly(alert, rows)

    fn = _OPS.get(alert.operator)
    if fn is None or not rows:
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


def _time_key(value: Any) -> str | None:
    """Normalise a time-column value to ONE comparable type, or None if unusable.

    A driver can hand back the same column as ``datetime``, ``date``, ``str`` or a
    number, and ``sorted()`` raises TypeError the moment two of those meet -- which
    here would take down the whole scheduler tick, not just one alert. Everything
    therefore collapses to a string whose lexicographic order matches chronological
    order: ISO for dates, zero-padded for a numeric axis (year, epoch, YYYYMM).
    """
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, datetime):
        normalised = aware(value)
        return normalised.isoformat() if normalised else None
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, (int, float)):
        # Negative (pre-epoch) values would need a sign-aware encoding to keep
        # lexicographic == numeric; they are dropped instead of mis-ordered.
        return f"{value:020.3f}" if value >= 0 else None
    if isinstance(value, str):
        return value.strip() or None
    return None


def _ordered_rows(alert: Alert, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Rows in time order, when the result set carries a time column.

    A SELECT without ORDER BY returns rows in whatever order the engine produced,
    so "the latest point" -- the entire basis of an anomaly alert, and what the
    notification text claims -- was really "whichever row happened to come last".

    Two deliberate fallbacks to the engine's order: no time column at all, and a
    time column no row can be keyed on (all NULL). Sorting is meaningless in both,
    and dropping every row would silence alerts that fire today.
    """
    # Local import: explore_service pulls in the whole query pipeline, and this
    # module is loaded by the alert API on every request.
    from app.services.explore_service import is_temporal

    if not rows:
        return rows
    col = next((c for c in rows[0] if c != alert.column and is_temporal(c)), None)
    if col is None:
        return rows
    keyed = [(key, r) for r in rows if (key := _time_key(r.get(col))) is not None]
    if not keyed:
        return rows
    # Key only, never the dict: comparing rows would raise on a tie.
    keyed.sort(key=lambda pair: pair[0])
    return [r for _key, r in keyed]


def _evaluate_anomaly(alert: Alert, rows: list[dict[str, Any]]) -> bool:
    """Fire when the most recent point of the column series is a statistical outlier."""
    from app.services import stats

    ordered = _ordered_rows(alert, rows)
    series = [v for r in ordered if (v := stats.to_float(r.get(alert.column))) is not None]
    if len(series) < 4:
        return False
    return (len(series) - 1) in set(stats.zscore_outliers(series))


def _in_cooldown(alert: Alert, now: datetime) -> bool:
    """True while the alert is still inside its post-breach silence window.

    ``cooldown_minutes == 0`` disables it, which is the pre-1.6 behaviour: fire on
    every evaluation.
    """
    if alert.cooldown_minutes <= 0:
        return False
    last = aware(alert.last_triggered_at)
    if last is None:
        return False
    return now - last < timedelta(minutes=alert.cooldown_minutes)


async def check_saved_query(db: AsyncSession, sq: SavedQuery, result: QueryResult) -> int:
    """Evaluate active alerts on a saved query; create notifications on breach.

    The cooldown is enforced HERE rather than in the scheduler because this is the
    single chokepoint all three evaluation paths share: ``run_due`` (hourly at
    most), ``POST /saved/{id}/run`` (every click of the Run button) and
    ``report_delivery_service`` (every scheduled report). Gating the scheduler
    would leave the two noisiest paths uncovered.
    """
    rows = result.data
    res = await db.execute(
        select(Alert).where(Alert.saved_query_id == sq.id, Alert.active.is_(True))
    )
    from app.services import integration_service, notify_service

    now = datetime.now(timezone.utc)
    fired = 0
    for alert in res.scalars().all():
        if evaluate(alert, rows):
            # Still silenced: leave last_triggered_at alone. Bumping it here would
            # restart the window on every evaluation, so a breach that outlives one
            # cooldown could never notify again.
            if _in_cooldown(alert, now):
                continue
            alert.last_triggered_at = now
            title = f"Alert: {alert.name}"
            if alert.condition_type == "anomaly":
                body = (
                    f"“{sq.name}” sorğusunda “{alert.column}” sütununun son nöqtəsi "
                    f"statistik anomaliyadır (MAD z-score)."
                )
            else:
                body = (
                    f"“{sq.name}” sorğusunda {alert.column} {alert.operator} "
                    f"{alert.threshold} şərti pozuldu."
                )
            await notify_service.create(
                db, alert.user_id, title, body, NotificationCategory.KPI_ALERT,
                alert_id=alert.id,
            )
            # Push to the user's workflow channels too (mock-first).
            await integration_service.dispatch(db, alert.user_id, title, body)
            fired += 1
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
