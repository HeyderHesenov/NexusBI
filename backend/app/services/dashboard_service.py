"""Dashboard and widget CRUD business logic."""
from __future__ import annotations

import asyncio
import secrets
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.exceptions import SchemaNotFoundError
from app.core.logging import get_logger
from app.db.session import AsyncSessionLocal
from app.models.datasource import DataSource
from app.models.dashboard import Dashboard, Widget
from app.models.query_log import QueryLog
from app.schemas.dashboard import WidgetChart, WidgetResponse
from app.services import query_service
from app.services.cache_service import CacheService

_log = get_logger("nexusbi.dashboard")


async def enable_share(db: AsyncSession, user_id: str, dashboard_id: str) -> str:
    dash = await get_dashboard(db, user_id, dashboard_id)
    if not dash.share_token:
        dash.share_token = secrets.token_urlsafe(24)
        await db.flush()
    return dash.share_token


async def disable_share(db: AsyncSession, user_id: str, dashboard_id: str) -> None:
    dash = await get_dashboard(db, user_id, dashboard_id)
    dash.share_token = None
    await db.flush()


async def get_by_token(db: AsyncSession, token: str) -> Dashboard:
    result = await db.execute(
        select(Dashboard)
        .where(Dashboard.share_token == token)
        .options(selectinload(Dashboard.widgets))
    )
    dash = result.scalar_one_or_none()
    if dash is None:
        raise SchemaNotFoundError("Paylaşılan dashboard tapılmadı.")
    return dash


async def create_dashboard(
    db: AsyncSession, user_id: str, name: str, description: str
) -> Dashboard:
    dash = Dashboard(user_id=user_id, name=name, description=description)
    db.add(dash)
    await db.flush()
    await db.refresh(dash)
    return dash


async def _run_planned_query(
    cache: CacheService, user_id: str, datasource_id: str | None, question: str
) -> tuple[str, str] | None:
    """Run one planned question in an isolated session. Returns (title, query_log_id)."""
    async with AsyncSessionLocal() as qdb:
        try:
            result = await query_service.process_nl_query(
                question, datasource_id, user_id, qdb, cache
            )
            await qdb.commit()
        except Exception as exc:  # noqa: BLE001 — one bad question shouldn't sink the board
            _log.warning("planned_query_failed", question=question[:80], error=str(exc)[:200])
            return None
    if not result.query_log_id or not result.data:
        return None
    return question, result.query_log_id


async def generate_dashboard(
    db: AsyncSession,
    cache: CacheService,
    user_id: str,
    goal: str,
    datasource_id: str | None,
) -> Dashboard:
    """Plan questions for ``goal``, run them concurrently, and assemble a dashboard.

    Each question runs in its own session (AsyncSession isn't concurrency-safe);
    widgets are laid out in a 2-column grid. Raises if nothing usable came back.
    """
    from app.ai import dashboard_planner

    questions = await dashboard_planner.plan_dashboard(goal)
    if not questions:
        raise SchemaNotFoundError("Dashboard planı yaradıla bilmədi.")

    results = await asyncio.gather(
        *[_run_planned_query(cache, user_id, datasource_id, q) for q in questions],
        return_exceptions=True,
    )
    widgets = [r for r in results if r is not None and not isinstance(r, BaseException)]
    if not widgets:
        raise SchemaNotFoundError("Sual nəticələri alınmadı.")

    dash = await create_dashboard(db, user_id, goal[:255], f"AI tərəfindən yaradıldı: {goal}"[:2000])
    # 2-column grid, 12 cols, each widget 6 wide × 8 tall.
    for i, (title, query_log_id) in enumerate(widgets):
        await add_widget(
            db,
            user_id,
            dash.id,
            {
                "query_log_id": query_log_id,
                "title": title[:255],
                "position_x": (i % 2) * 6,
                "position_y": (i // 2) * 8,
                "width": 6,
                "height": 8,
            },
        )
    await db.flush()
    # add_widget's ownership check eager-loaded dash.widgets as empty; drop that
    # cached collection so the reload below sees the freshly inserted widgets.
    db.expire(dash, ["widgets"])
    return await get_dashboard(db, user_id, dash.id)


async def list_dashboards(db: AsyncSession, user_id: str) -> list[Dashboard]:
    result = await db.execute(
        select(Dashboard).where(Dashboard.user_id == user_id)
    )
    return list(result.scalars().all())


async def get_dashboard(db: AsyncSession, user_id: str, dashboard_id: str) -> Dashboard:
    result = await db.execute(
        select(Dashboard)
        .where(Dashboard.id == dashboard_id, Dashboard.user_id == user_id)
        .options(selectinload(Dashboard.widgets))
    )
    dash = result.scalar_one_or_none()
    if dash is None:
        raise SchemaNotFoundError("Dashboard tapılmadı.")
    return dash


def _widget_chart(log: QueryLog | None, ds_names: dict[str, str]) -> WidgetChart | None:
    """Build the embedded render snapshot for a widget from its query log."""
    if log is None:
        return None
    result = log.result_data or {}
    # Always emit a usable chart_config so the client never reconstructs it.
    chart_config = log.chart_config or {
        "chart_type": log.chart_type,
        "x_axis": None,
        "y_axis": None,
        "color_by": None,
    }
    return WidgetChart(
        chart_type=log.chart_type,
        chart_config=chart_config,
        columns=result.get("columns", []),
        data=result.get("rows", []),
        insight=log.insight,
        sql=log.generated_sql,
        natural_language=log.natural_language,
        datasource_id=log.datasource_id,
        datasource_name=ds_names.get(log.datasource_id, "Demo") if log.datasource_id else "Demo",
    )


async def widgets_to_response(
    db: AsyncSession, widgets: list[Widget], user_id: str
) -> list[WidgetResponse]:
    """Serialize widgets, batch-loading query logs + datasources (no N+1).

    Query logs are scoped to ``user_id`` so a widget can never surface another
    user's data even if it references a foreign query_log_id.
    """
    log_ids = {w.query_log_id for w in widgets if w.query_log_id}
    by_id: dict[str, QueryLog] = {}
    if log_ids:
        rows = await db.execute(
            select(QueryLog).where(
                QueryLog.id.in_(log_ids), QueryLog.user_id == user_id
            )
        )
        by_id = {q.id: q for q in rows.scalars().all()}

    ds_ids = {q.datasource_id for q in by_id.values() if q.datasource_id}
    ds_names: dict[str, str] = {}
    if ds_ids:
        rows = await db.execute(
            select(DataSource.id, DataSource.name).where(DataSource.id.in_(ds_ids))
        )
        ds_names = {ds_id: name for ds_id, name in rows.all()}

    return [
        WidgetResponse(
            id=w.id,
            title=w.title,
            query_log_id=w.query_log_id,
            position_x=w.position_x,
            position_y=w.position_y,
            width=w.width,
            height=w.height,
            chart=_widget_chart(by_id.get(w.query_log_id) if w.query_log_id else None, ds_names),
        )
        for w in widgets
    ]


async def update_dashboard(
    db: AsyncSession, user_id: str, dashboard_id: str, fields: dict[str, Any]
) -> Dashboard:
    dash = await get_dashboard(db, user_id, dashboard_id)
    for key, value in fields.items():
        if value is not None:
            setattr(dash, key, value)
    await db.flush()
    await db.refresh(dash)
    return dash


async def delete_dashboard(db: AsyncSession, user_id: str, dashboard_id: str) -> None:
    dash = await get_dashboard(db, user_id, dashboard_id)
    await db.delete(dash)
    await db.flush()


async def add_widget(
    db: AsyncSession, user_id: str, dashboard_id: str, data: dict[str, Any]
) -> Widget:
    await get_dashboard(db, user_id, dashboard_id)  # ownership check
    # Reject query logs that don't belong to this user (no cross-user attach).
    query_log_id = data.get("query_log_id")
    if query_log_id:
        owned = await db.execute(
            select(QueryLog.id).where(
                QueryLog.id == query_log_id, QueryLog.user_id == user_id
            )
        )
        if owned.scalar_one_or_none() is None:
            raise SchemaNotFoundError("Sorğu tapılmadı.")
    widget = Widget(dashboard_id=dashboard_id, **data)
    db.add(widget)
    await db.flush()
    await db.refresh(widget)
    return widget


async def _get_widget(
    db: AsyncSession, user_id: str, dashboard_id: str, widget_id: str
) -> Widget:
    await get_dashboard(db, user_id, dashboard_id)  # ownership check
    result = await db.execute(
        select(Widget).where(Widget.id == widget_id, Widget.dashboard_id == dashboard_id)
    )
    widget = result.scalar_one_or_none()
    if widget is None:
        raise SchemaNotFoundError("Widget tapılmadı.")
    return widget


async def _refresh(db: AsyncSession, cache: CacheService, user_id: str, widget: Widget) -> Widget:
    """Re-run the widget's query against its own datasource and repoint it."""
    if not widget.query_log_id:
        return widget
    log_row = await db.execute(
        select(QueryLog).where(
            QueryLog.id == widget.query_log_id, QueryLog.user_id == user_id
        )
    )
    log = log_row.scalar_one_or_none()
    if log is None:
        return widget
    result = await query_service.process_nl_query(
        log.natural_language, log.datasource_id, user_id, db, cache, bypass_cache=True
    )
    widget.query_log_id = result.query_log_id
    await db.flush()
    return widget


async def refresh_widget(
    db: AsyncSession, cache: CacheService, user_id: str, dashboard_id: str, widget_id: str
) -> Widget:
    widget = await _get_widget(db, user_id, dashboard_id, widget_id)
    return await _refresh(db, cache, user_id, widget)


async def _run_widget_query(
    cache: CacheService, user_id: str, query_log_id: str
) -> str | None:
    """Re-run one widget's query in an ISOLATED session; return new query_log_id.

    Each widget gets its own session so the queries can run concurrently — an
    AsyncSession is not safe for concurrent use on a shared instance.
    """
    async with AsyncSessionLocal() as wdb:
        log_row = await wdb.execute(
            select(QueryLog).where(
                QueryLog.id == query_log_id, QueryLog.user_id == user_id
            )
        )
        log = log_row.scalar_one_or_none()
        if log is None:
            return None
        result = await query_service.process_nl_query(
            log.natural_language, log.datasource_id, user_id, wdb, cache, bypass_cache=True
        )
        await wdb.commit()
        return result.query_log_id


async def refresh_all_widgets(
    db: AsyncSession, cache: CacheService, user_id: str, dashboard_id: str
) -> Dashboard:
    dash = await get_dashboard(db, user_id, dashboard_id)
    widgets = [w for w in dash.widgets if w.query_log_id]
    # Run every widget's query concurrently (each in its own session), then
    # repoint widgets on the shared session. One widget's failure is isolated.
    results = await asyncio.gather(
        *[_run_widget_query(cache, user_id, w.query_log_id) for w in widgets],
        return_exceptions=True,
    )
    for widget, res in zip(widgets, results):
        if isinstance(res, Exception):
            _log.warning("widget_refresh_failed", widget_id=widget.id, error=str(res))
        elif res:
            widget.query_log_id = res
    await db.flush()
    return await get_dashboard(db, user_id, dashboard_id)


async def delete_widget(
    db: AsyncSession, user_id: str, dashboard_id: str, widget_id: str
) -> None:
    await get_dashboard(db, user_id, dashboard_id)  # ownership check
    result = await db.execute(
        select(Widget).where(
            Widget.id == widget_id, Widget.dashboard_id == dashboard_id
        )
    )
    widget = result.scalar_one_or_none()
    if widget is None:
        raise SchemaNotFoundError("Widget tapılmadı.")
    await db.delete(widget)
    await db.flush()
