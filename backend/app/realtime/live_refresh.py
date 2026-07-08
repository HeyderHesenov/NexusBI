"""Real-time dashboard refresh loop.

Wakes every ``LIVE_REFRESH_TICK_SECONDS`` and, for every live-enabled dashboard
that currently has at least one connected client, re-runs its widget queries
(data-only, no AI) and pushes the fresh charts over the collab WebSocket. Each
dashboard honours its own ``live_interval_seconds``; demo dashboards get a data
nudge first so the numbers visibly move.

Single-process, mirrors services.scheduler. No effect on dashboards nobody is
watching, so it never burns work in the background.
"""
from __future__ import annotations

import asyncio
import time

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.config import settings
from app.core.logging import get_logger
from app.db.session import AsyncSessionLocal
from app.models.dashboard import Dashboard
from app.realtime.hub import hub
from app.services import dashboard_filter_sql, dashboard_service, demo_feed

log = get_logger("nexusbi.live")

# dashboard_id -> monotonic timestamp of last refresh (per-dashboard throttle).
_last_run: dict[str, float] = {}


async def _refresh_dashboard(dash_id: str, user_id: str) -> None:
    """Re-run one dashboard's widgets and broadcast the fresh charts."""
    from app.services.cache_service import build_cache_service

    updates: list[dict] = []
    cache = await build_cache_service()
    try:
        async with AsyncSessionLocal() as db:
            dash = (
                await db.execute(
                    select(Dashboard)
                    .where(Dashboard.id == dash_id, Dashboard.user_id == user_id)
                    .options(selectinload(Dashboard.widgets))
                )
            ).scalar_one_or_none()
            if dash is None:
                return
            if dashboard_filter_sql.filter_active(dash.global_filter):
                # A global filter is active: broadcast the FILTERED view. This path
                # re-runs the filtered SQL WITHOUT persisting result_data, so the
                # canonical unfiltered snapshot isn't corrupted (clearing the filter
                # still returns the real baseline).
                filtered = await dashboard_service.apply_global_filter(
                    db, user_id, dash_id, dash.global_filter, cache, skip_rls=True
                )
                updates = [
                    {"widget_id": fw["widget_id"], "chart": fw["chart"].model_dump(mode="json")}
                    for fw in filtered
                    if fw["chart"] is not None
                ]
            else:
                for widget in dash.widgets:
                    if not widget.query_log_id:
                        continue
                    try:
                        chart = await dashboard_service.refresh_widget_data(db, widget, user_id, cache)
                    except Exception as exc:  # noqa: BLE001 — one widget failing can't sink the tick
                        log.warning("live_widget_failed", widget_id=widget.id, error=str(exc)[:200])
                        continue
                    if chart is not None:
                        updates.append({"widget_id": widget.id, "chart": chart.model_dump(mode="json")})
                await db.commit()
    finally:
        await cache.aclose()
    if updates:
        await hub.broadcast(dash_id, {"type": "live_update", "widgets": updates})


async def _tick() -> None:
    rooms = hub.active_rooms()
    if not rooms:
        return
    async with AsyncSessionLocal() as db:
        dashes = (
            await db.execute(
                select(Dashboard.id, Dashboard.user_id, Dashboard.live_interval_seconds).where(
                    Dashboard.id.in_(rooms), Dashboard.live_enabled.is_(True)
                )
            )
        ).all()
    if not dashes:
        return

    now = time.monotonic()
    due = [
        (did, uid)
        for did, uid, interval in dashes
        if now - _last_run.get(did, 0.0) >= max(interval, settings.LIVE_REFRESH_TICK_SECONDS)
    ]
    if not due:
        return

    # Nudge the demo feed once per tick so all demo dashboards move together.
    if settings.LIVE_DEMO_FEED:
        demo_feed.nudge()

    for dash_id, user_id in due:
        _last_run[dash_id] = now
        try:
            await _refresh_dashboard(dash_id, user_id)
        except Exception as exc:  # noqa: BLE001 — keep the loop alive
            log.error("live_refresh_failed", dashboard_id=dash_id, error=str(exc)[:200])


async def run_loop() -> None:
    log.info("live_refresh_started", tick=settings.LIVE_REFRESH_TICK_SECONDS)
    while True:
        await asyncio.sleep(settings.LIVE_REFRESH_TICK_SECONDS)
        try:
            await _tick()
        except Exception as exc:  # noqa: BLE001 — never let a tick kill the loop
            log.error("live_tick_failed", error=str(exc)[:200])
