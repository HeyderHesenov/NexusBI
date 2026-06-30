"""Decision (Insight → Action → Outcome) CRUD + the Decision Intelligence Loop.

Beyond plain CRUD, a decision can be *bound to a metric* (an NL query). We
capture a ``baseline`` at decision time and re-measure ``realized`` over time —
cheaply re-running the bound query's stored SQL with no AI — so the app can
score its own recommendations (``accuracy_summary``) and close the loop.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import delete as sa_delete
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import SchemaNotFoundError
from app.core.logging import get_logger
from app.models.decision import Decision, DecisionMeasurement
from app.services.cache_service import CacheService

_log = get_logger("nexusbi.decision")

# Editable fields a DecisionUpdate may patch.
_EDITABLE = (
    "title", "action", "status", "outcome",
    "metric_query", "metric_column", "predicted_value",
    "predicted_direction", "measure_cadence",
)
_CADENCE_SECONDS = {"daily": 86400, "weekly": 604800}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


# ─── Numeric extraction (shared metric→scalar logic) ───

def _first_numeric_column(rows: list[dict[str, Any]]) -> str | None:
    for row in rows:
        for col, val in row.items():
            if isinstance(val, bool):
                continue
            if isinstance(val, (int, float)):
                return col
            try:
                float(val)
                return col
            except (TypeError, ValueError):
                continue
        break  # only inspect the first row's shape
    return None


def extract_scalar(rows: list[dict[str, Any]], column: str | None = None) -> float | None:
    """Reduce a result set to one representative number for a metric.

    Single row → that column's value; multiple rows → the column's sum (matches
    "total"-style measures). ``column`` defaults to the first numeric column.
    """
    if not rows:
        return None
    col = column if (column and column in rows[0]) else _first_numeric_column(rows)
    if col is None:
        return None
    nums: list[float] = []
    for row in rows:
        raw = row.get(col)
        if raw is None or isinstance(raw, bool):
            continue
        try:
            nums.append(float(raw))
        except (TypeError, ValueError):
            continue
    if not nums:
        return None
    return nums[0] if len(nums) == 1 else float(sum(nums))


# ─── Impact scoring ───

def _resolved_direction(d: Decision) -> str:
    """The intended direction: explicit, else inferred from predicted vs baseline."""
    if d.predicted_direction:
        return d.predicted_direction
    if d.predicted_value is not None and d.baseline_value is not None:
        return "increase" if d.predicted_value >= d.baseline_value else "decrease"
    return "increase"


def _compute_impact_status(d: Decision) -> str:
    if d.baseline_value is None or d.realized_value is None:
        return "pending"
    moved = d.realized_value - d.baseline_value
    direction = _resolved_direction(d)
    if direction == "increase":
        if moved < 0:
            status = "regressed"
        elif d.predicted_value is not None and d.realized_value >= d.predicted_value:
            status = "achieved"
        else:
            status = "on_track" if moved > 0 else "pending"
    else:  # decrease
        if moved > 0:
            status = "regressed"
        elif d.predicted_value is not None and d.realized_value <= d.predicted_value:
            status = "achieved"
        else:
            status = "on_track" if moved < 0 else "pending"
    # A closed decision that never hit its target is a miss, not "still on track".
    if d.status == "done" and status in ("on_track", "pending"):
        status = "missed"
    return status


# ─── Measurement engine ───

async def _measure(
    db: AsyncSession, cache: CacheService, d: Decision, *, allow_ai_fallback: bool = True
) -> tuple[float | None, str | None]:
    """Return (value, query_log_id) for the decision's bound metric, now.

    Prefers an AI-free re-run of the bound query's stored SQL. A full NL→SQL pass
    (which costs AI inference) is only used when no prior log is usable AND
    ``allow_ai_fallback`` is set — scheduled re-measures pass False so a transient
    re-run failure can never silently escalate to paid inference on every tick.
    """
    from app.models.query_log import QueryLog
    from app.services import query_service

    if d.last_query_log_id:
        log = await db.get(QueryLog, d.last_query_log_id)
        if log is not None and log.generated_sql:
            try:
                _cols, rows = await query_service.reexecute_logged_query(log, db, d.user_id, cache)
                return extract_scalar(rows, d.metric_column), log.id
            except Exception as exc:  # noqa: BLE001
                _log.warning("decision_reexecute_failed", decision_id=d.id, error=str(exc)[:200])
    if not d.metric_query or not allow_ai_fallback:
        return None, None
    result = await query_service.process_nl_query(
        d.metric_query, d.datasource_id, d.user_id, db, cache, bypass_cache=True
    )
    return extract_scalar(result.data, d.metric_column), result.query_log_id


async def _capture_baseline(db: AsyncSession, cache: CacheService, d: Decision) -> None:
    """Set the baseline at decision time. Reuses the spawning query's result if
    present (no re-run / no quota), else runs the metric query once."""
    from app.models.query_log import QueryLog
    from app.services import query_service

    value: float | None = None
    log_id: str | None = None
    if d.query_log_id:
        log = await db.get(QueryLog, d.query_log_id)
        if log is not None and log.result_data:
            value = extract_scalar(log.result_data.get("rows", []), d.metric_column)
            log_id = log.id
    if value is None and d.metric_query:
        # A live metric run can fail (bad source, AI error) — a failed baseline must
        # not 500 the decision create. Capture what we can; leave baseline null otherwise.
        try:
            result = await query_service.process_nl_query(
                d.metric_query, d.datasource_id, d.user_id, db, cache
            )
            value = extract_scalar(result.data, d.metric_column)
            log_id = result.query_log_id
        except Exception as exc:  # noqa: BLE001
            _log.warning("decision_baseline_failed", decision_id=d.id, error=str(exc)[:200])
            return
    if value is None:
        return
    d.baseline_value = value
    d.baseline_at = _now()
    d.last_query_log_id = log_id
    db.add(DecisionMeasurement(decision_id=d.id, value=value, measured_at=d.baseline_at, query_log_id=log_id))


async def measure(
    db: AsyncSession, cache: CacheService, d: Decision, *, allow_ai_fallback: bool = True
) -> Decision:
    """Re-measure the realized value, append to the trajectory, update status."""
    value, log_id = await _measure(db, cache, d, allow_ai_fallback=allow_ai_fallback)
    if value is None:
        return d
    now = _now()
    d.realized_value = value
    d.realized_at = now
    if log_id:
        d.last_query_log_id = log_id
    db.add(DecisionMeasurement(decision_id=d.id, value=value, measured_at=now, query_log_id=log_id))
    prev_status = d.impact_status
    d.impact_status = _compute_impact_status(d)
    await db.flush()
    if d.impact_status in ("achieved", "regressed") and d.impact_status != prev_status:
        await _notify_impact(db, d)
    return d


async def _notify_impact(db: AsyncSession, d: Decision) -> None:
    from app.models.alert import Notification
    from app.services import integration_service

    if d.impact_status == "achieved":
        title = f"🎯 Qərar nəticə verdi: {d.title}"
        body = (
            f"Hədəf yerinə yetdi — baseline {d.baseline_value:g} → real {d.realized_value:g}."
        )
    else:
        title = f"⚠️ Qərar geriləyir: {d.title}"
        body = (
            f"Metrik gözlənilən istiqamətin əksinə getdi — "
            f"baseline {d.baseline_value:g} → real {d.realized_value:g}."
        )
    db.add(Notification(user_id=d.user_id, title=title, body=body))
    await db.flush()
    await integration_service.dispatch(db, d.user_id, title, body)


def _is_due(d: Decision, now: datetime) -> bool:
    interval = _CADENCE_SECONDS.get(d.measure_cadence)
    if interval is None:
        return False
    last = _aware(d.realized_at) or _aware(d.baseline_at)
    if last is None:
        return True
    return now - last >= timedelta(seconds=interval)


async def run_measurements_due(db: AsyncSession, cache: CacheService) -> int:
    """Re-measure every decision whose cadence is due. Returns count measured.

    Each decision is isolated: one that errors (e.g. its datasource was deleted)
    is logged and skipped so it can't abort the whole batch or wedge the scheduler.
    Scheduled re-measures never fall back to paid AI inference.
    """
    now = _now()
    result = await db.execute(select(Decision).where(Decision.measure_cadence != "off"))
    measured = 0
    for d in result.scalars().all():
        if not _is_due(d, now):
            continue
        try:
            await measure(db, cache, d, allow_ai_fallback=False)
            measured += 1
        except Exception as exc:  # noqa: BLE001 — one bad decision must not sink the batch
            _log.warning("decision_measure_skipped", decision_id=d.id, error=str(exc)[:200])
    return measured


# ─── ROI / accuracy reads ───

def roi(d: Decision) -> dict[str, Any]:
    baseline, predicted, realized = d.baseline_value, d.predicted_value, d.realized_value
    delta_abs = (realized - baseline) if (realized is not None and baseline is not None) else None
    delta_pct = (
        round(delta_abs / abs(baseline) * 100, 2)
        if (delta_abs is not None and baseline not in (None, 0))
        else None
    )
    progress_pct: float | None = None
    if baseline is not None and predicted is not None and realized is not None and predicted != baseline:
        progress_pct = round((realized - baseline) / (predicted - baseline) * 100, 1)
    return {
        "decision_id": d.id,
        "baseline_value": baseline,
        "predicted_value": predicted,
        "realized_value": realized,
        "predicted_direction": d.predicted_direction,
        "delta_abs": round(delta_abs, 4) if delta_abs is not None else None,
        "delta_pct": delta_pct,
        "progress_pct": progress_pct,
        "impact_status": d.impact_status,
        "baseline_at": d.baseline_at,
        "realized_at": d.realized_at,
    }


async def accuracy_summary(db: AsyncSession, user_id: str) -> dict[str, Any]:
    """How well this user's predictions matched reality — the calibration signal."""
    result = await db.execute(
        select(Decision).where(
            Decision.user_id == user_id,
            Decision.baseline_value.is_not(None),
            Decision.realized_value.is_not(None),
        )
    )
    decisions = list(result.scalars().all())
    evaluated = len(decisions)
    if not evaluated:
        return {
            "total_measured": 0, "direction_hit_rate": None,
            "achieved": 0, "accuracy_pct": None, "avg_magnitude_error_pct": None,
        }
    hits = 0
    achieved = 0
    mag_errors: list[float] = []
    for d in decisions:
        moved = d.realized_value - d.baseline_value
        direction = _resolved_direction(d)
        if (direction == "increase" and moved > 0) or (direction == "decrease" and moved < 0):
            hits += 1
        if d.impact_status == "achieved":
            achieved += 1
        if d.predicted_value not in (None, 0):
            mag_errors.append(abs(d.realized_value - d.predicted_value) / abs(d.predicted_value))
    return {
        "total_measured": evaluated,
        # Directional correctness (got the sign right) vs target attainment (hit the
        # number) are different signals — surface both, don't conflate them.
        "direction_hit_rate": round(hits / evaluated * 100, 1),
        "achieved": achieved,
        "accuracy_pct": round(achieved / evaluated * 100, 1),
        "avg_magnitude_error_pct": round(sum(mag_errors) / len(mag_errors) * 100, 1) if mag_errors else None,
    }


async def trajectory(db: AsyncSession, user_id: str, decision_id: str) -> list[DecisionMeasurement]:
    await get(db, user_id, decision_id)  # ownership check
    result = await db.execute(
        select(DecisionMeasurement)
        .where(DecisionMeasurement.decision_id == decision_id)
        .order_by(DecisionMeasurement.measured_at.asc())
    )
    return list(result.scalars().all())


# ─── CRUD ───

async def create(db: AsyncSession, cache: CacheService, user_id: str, payload) -> Decision:
    d = Decision(
        user_id=user_id,
        title=payload.title,
        insight=payload.insight,
        action=payload.action,
        query_log_id=payload.query_log_id,
        metric_query=payload.metric_query,
        metric_column=payload.metric_column,
        datasource_id=payload.datasource_id,
        predicted_value=payload.predicted_value,
        predicted_direction=payload.predicted_direction,
        measure_cadence=payload.measure_cadence or "off",
    )
    db.add(d)
    await db.flush()
    if d.metric_query or d.query_log_id:
        await _capture_baseline(db, cache, d)
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
    for field in _EDITABLE:
        value = getattr(payload, field, None)
        if value is not None:
            setattr(d, field, value)
    # Only re-score once a realized value exists; an unmeasured decision stays
    # "pending" regardless of edits, and we never rescore without a measurement.
    if d.realized_value is not None:
        d.impact_status = _compute_impact_status(d)
    await db.flush()
    await db.refresh(d)
    return d


async def delete(db: AsyncSession, user_id: str, decision_id: str) -> None:
    d = await get(db, user_id, decision_id)
    # Explicitly clear the trajectory: the DB-level ON DELETE CASCADE is inert on
    # SQLite (no PRAGMA foreign_keys), so delete children here to avoid orphans
    # regardless of backend.
    await db.execute(sa_delete(DecisionMeasurement).where(DecisionMeasurement.decision_id == d.id))
    await db.delete(d)
    await db.flush()
