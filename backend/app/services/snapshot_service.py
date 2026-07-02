"""Dashboard time machine — capture, list and prune point-in-time snapshots.

A snapshot copies each widget's PERSISTED query-log result (no re-execution),
so it records the stored truth at capture time. Retention is enforced here
(SQLite's ON DELETE CASCADE is inert in this app, so pruning is explicit).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import SchemaNotFoundError
from app.core.logging import get_logger
from app.models.dashboard import Dashboard
from app.models.dashboard_snapshot import DashboardSnapshot
from app.services import dashboard_service, query_service

log = get_logger("nexusbi.snapshots")

MAX_SNAPSHOTS_PER_DASHBOARD = 50  # per origin (manual and scheduled pruned separately)
# Must equal the query-log persistence cap: the client diffs snapshot rows
# against the widget's stored rows, and asymmetric caps would fabricate drift
# on any unchanged widget whose result exceeds the smaller cap.
MAX_ROWS_PER_WIDGET = query_service._SNAPSHOT_MAX_ROWS
SCHEDULED_CAPTURE_INTERVAL = timedelta(hours=1)


async def capture(
    db: AsyncSession,
    user_id: str,
    dashboard_id: str,
    label: str = "",
    origin: str = "manual",
) -> DashboardSnapshot:
    """Snapshot every widget's stored data; prune beyond the retention cap."""
    dash = await dashboard_service.get_dashboard(db, user_id, dashboard_id)
    logs_by_id = await dashboard_service.load_widget_query_logs(
        db, list(dash.widgets), user_id
    )

    widgets: list[dict[str, Any]] = []
    for w in dash.widgets:
        qlog = logs_by_id.get(w.query_log_id) if w.query_log_id else None
        result = (qlog.result_data or {}) if qlog else {}
        widgets.append(
            {
                "widget_id": w.id,
                "title": w.title,
                "chart_type": qlog.chart_type if qlog else "table",
                "chart_config": (qlog.chart_config if qlog else None) or {},
                "columns": result.get("columns", []),
                "rows": (result.get("rows") or [])[:MAX_ROWS_PER_WIDGET],
            }
        )

    snap = DashboardSnapshot(
        dashboard_id=dash.id,
        user_id=user_id,
        label=label.strip()[:120],
        origin=origin,
        # layout is captured for a future "render in the real grid" view —
        # append-only data can't be backfilled later.
        payload={"widgets": widgets, "layout": dash.layout},
        # Explicit microsecond timestamp: SQLite's CURRENT_TIMESTAMP is
        # second-resolution, which makes prune/list ordering undefined for
        # captures landing in the same second.
        created_at=datetime.now(timezone.utc),
    )
    db.add(snap)
    await db.flush()
    await _prune(db, dash.id, origin)
    await db.commit()
    await db.refresh(snap)
    return snap


async def _prune(db: AsyncSession, dashboard_id: str, origin: str) -> None:
    """Keep only the newest MAX_SNAPSHOTS_PER_DASHBOARD snapshots PER ORIGIN.

    Pruning within the capture's own origin means hourly scheduled captures
    can never evict a user's manually labeled bookmarks (and vice versa).
    """
    keep = (
        select(DashboardSnapshot.id)
        .where(
            DashboardSnapshot.dashboard_id == dashboard_id,
            DashboardSnapshot.origin == origin,
        )
        .order_by(DashboardSnapshot.created_at.desc(), DashboardSnapshot.id.desc())
        .limit(MAX_SNAPSHOTS_PER_DASHBOARD)
    ).scalar_subquery()
    await db.execute(
        delete(DashboardSnapshot).where(
            DashboardSnapshot.dashboard_id == dashboard_id,
            DashboardSnapshot.origin == origin,
            DashboardSnapshot.id.not_in(keep),
        )
    )


async def list_meta(db: AsyncSession, user_id: str, dashboard_id: str) -> list[dict]:
    """Timeline metadata only — never loads the (potentially large) payloads."""
    await dashboard_service.get_dashboard(db, user_id, dashboard_id)  # ownership gate
    rows = await db.execute(
        select(
            DashboardSnapshot.id,
            DashboardSnapshot.label,
            DashboardSnapshot.origin,
            DashboardSnapshot.created_at,
        )
        .where(DashboardSnapshot.dashboard_id == dashboard_id)
        .order_by(DashboardSnapshot.created_at.desc(), DashboardSnapshot.id.desc())
    )
    return [
        {"id": r.id, "label": r.label, "origin": r.origin, "created_at": r.created_at}
        for r in rows.all()
    ]


async def get(
    db: AsyncSession, user_id: str, dashboard_id: str, snapshot_id: str
) -> DashboardSnapshot:
    await dashboard_service.get_dashboard(db, user_id, dashboard_id)  # ownership gate
    snap = await db.get(DashboardSnapshot, snapshot_id)
    if snap is None or snap.dashboard_id != dashboard_id:
        raise SchemaNotFoundError("Snapshot tapılmadı.")
    return snap


async def remove(
    db: AsyncSession, user_id: str, dashboard_id: str, snapshot_id: str
) -> None:
    snap = await get(db, user_id, dashboard_id, snapshot_id)
    await db.delete(snap)
    await db.commit()


async def run_scheduled_captures(db: AsyncSession) -> int:
    """Hourly automatic snapshots for LIVE dashboards (scheduler phase).

    Each dashboard is isolated in its own try/except so one failure can't
    break the batch (mirrors decision_service.run_measurements_due).
    """
    rows = await db.execute(select(Dashboard).where(Dashboard.live_enabled.is_(True)))
    dashboards = list(rows.scalars().all())
    if not dashboards:
        return 0
    # One GROUP BY replaces a per-dashboard latest-snapshot query: the
    # scheduler ticks every minute, so the idle steady state must stay cheap.
    last_rows = await db.execute(
        select(DashboardSnapshot.dashboard_id, func.max(DashboardSnapshot.created_at))
        .where(
            DashboardSnapshot.dashboard_id.in_([d.id for d in dashboards]),
            DashboardSnapshot.origin == "scheduled",
        )
        .group_by(DashboardSnapshot.dashboard_id)
    )
    last_by_dash = dict(last_rows.all())
    captured = 0
    cutoff = datetime.now(timezone.utc) - SCHEDULED_CAPTURE_INTERVAL
    for dash in dashboards:
        try:
            last_at = last_by_dash.get(dash.id)
            if last_at is not None and last_at.replace(tzinfo=timezone.utc) > cutoff:
                continue
            await capture(db, dash.user_id, dash.id, origin="scheduled")
            captured += 1
        except Exception as exc:  # noqa: BLE001 — isolate per dashboard
            await db.rollback()
            log.error("scheduled_snapshot_failed", dashboard_id=dash.id, error=str(exc))
    return captured
