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
from app.schemas.dashboard import DashboardResponse, WidgetChart, WidgetResponse
from app.services import query_service
from app.services.cache_service import CacheService

_log = get_logger("nexusbi.dashboard")


async def to_response(db: AsyncSession, user_id: str, dash: Dashboard) -> DashboardResponse:
    """Serialize a dashboard (with widgets) to its API response shape.

    Single source of truth so every endpoint that returns a dashboard stays in
    sync (create/get/generate/requirements-build/live).
    """
    return DashboardResponse(
        id=dash.id,
        name=dash.name,
        description=dash.description,
        layout=dash.layout,
        global_filter=dash.global_filter,
        live_enabled=dash.live_enabled,
        live_interval_seconds=dash.live_interval_seconds,
        widgets=await widgets_to_response(db, list(dash.widgets), user_id),
    )


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


async def assemble_dashboard(
    db: AsyncSession,
    cache: CacheService,
    user_id: str,
    name: str,
    description: str,
    questions: list[str],
    datasource_id: str | None,
) -> Dashboard:
    """Run ``questions`` concurrently (each in its own session) and lay them out.

    Shared by the AI auto-dashboard (questions from the planner) and the
    requirements→dashboard flow (questions from extracted KPIs). Widgets are
    placed in a 2-column grid. Raises if nothing usable came back.
    """
    results = await asyncio.gather(
        *[_run_planned_query(cache, user_id, datasource_id, q) for q in questions],
        return_exceptions=True,
    )
    widgets = [r for r in results if r is not None and not isinstance(r, BaseException)]
    if not widgets:
        raise SchemaNotFoundError("Sual nəticələri alınmadı.")

    dash = await create_dashboard(db, user_id, name[:255], description[:2000])
    return await layout_widgets(db, user_id, dash, widgets)


async def layout_widgets(
    db: AsyncSession,
    user_id: str,
    dash: Dashboard,
    items: list[tuple[str, str]],
) -> Dashboard:
    """Place ``(title, query_log_id)`` items into a 2-column grid, then reload.

    Shared by the AI auto-dashboard, the requirements→dashboard flow, and the
    Explore auto-dashboard so widget layout stays identical across all three.
    """
    # 2-column grid, 12 cols, each widget 6 wide × 8 tall.
    for i, (title, query_log_id) in enumerate(items):
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


async def generate_dashboard(
    db: AsyncSession,
    cache: CacheService,
    user_id: str,
    goal: str,
    datasource_id: str | None,
) -> Dashboard:
    """Plan questions for ``goal`` (AI), then assemble a dashboard from them."""
    from app.ai import dashboard_planner

    questions = await dashboard_planner.plan_dashboard(goal)
    if not questions:
        raise SchemaNotFoundError("Dashboard planı yaradıla bilmədi.")
    return await assemble_dashboard(
        db, cache, user_id, goal, f"AI tərəfindən yaradıldı: {goal}", questions, datasource_id
    )


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


async def get_dashboard_for_view(
    db: AsyncSession, viewer_id: str, dashboard_id: str
) -> tuple[Dashboard, str]:
    """Return ``(dashboard, owner_id)`` for a read.

    Owner path first (``owner_id == viewer_id``). On a miss, a workspace member
    viewing a SHARED dashboard: the board is loaded WITHOUT the owner filter and
    the real owner id is returned so the render runs "as the owner". Raises 404 if
    the viewer neither owns it nor is a member it's shared to. Mutations must keep
    using the owner-only ``get_dashboard``.
    """
    try:
        dash = await get_dashboard(db, viewer_id, dashboard_id)
        return dash, viewer_id
    except SchemaNotFoundError:
        from app.services import resource_share_service

        owner_id = await resource_share_service.dashboard_owner_for_viewer(
            db, viewer_id, dashboard_id
        )
        if owner_id is None:
            raise
        result = await db.execute(
            select(Dashboard)
            .where(Dashboard.id == dashboard_id)
            .options(selectinload(Dashboard.widgets))
        )
        dash = result.scalar_one_or_none()
        if dash is None:
            raise
        return dash, owner_id


async def render_dashboard_for_viewer(
    db: AsyncSession,
    dash: Dashboard,
    owner_id: str,
    viewer_id: str,
    cache: CacheService | None = None,
) -> DashboardResponse:
    """Render a SHARED dashboard for a workspace member (read-only).

    Widgets and their query logs belong to the OWNER (loaded via ``owner_id``).
    RLS-LEAK INVARIANT: before returning any widget's data we check the VIEWER's
    RLS on that widget's datasource. If the viewer has ANY rule there, the owner's
    (unfiltered) stored snapshot MUST NOT be served — the widget's SQL is
    re-executed with the VIEWER as the RLS subject, so the member sees the owner's
    data constrained by exactly the member's rules. On any failure the widget
    renders empty (fail-closed). Nothing here is persisted.
    """
    from app.services import rls_service

    widgets = list(dash.widgets)
    logs = await load_widget_query_logs(db, widgets, owner_id)

    ds_ids = {q.datasource_id for q in logs.values() if q.datasource_id}
    ds_names: dict[str, str] = {}
    if ds_ids:
        rows = await db.execute(
            select(DataSource.id, DataSource.name).where(DataSource.id.in_(ds_ids))
        )
        ds_names = {ds_id: name for ds_id, name in rows.all()}

    widget_responses: list[WidgetResponse] = []
    for w in widgets:
        log = logs.get(w.query_log_id) if w.query_log_id else None
        chart = None
        if log is not None:
            restricted = bool(
                log.datasource_id
                and await rls_service.rules_for_user(db, log.datasource_id, viewer_id)
            )
            if restricted:
                # Never serve the owner's unfiltered snapshot to a restricted viewer —
                # re-run under the viewer's row scope (fail-closed on any error).
                try:
                    columns, rows_data = await query_service.reexecute_logged_query(
                        log, db, viewer_id, cache, owner_id=owner_id
                    )
                    chart = _chart_snapshot(
                        log, columns, query_service.snapshot_rows(rows_data), ds_names
                    )
                except Exception as exc:  # noqa: BLE001 — no data beats leaking owner rows
                    _log.warning(
                        "shared_widget_rls_reexec_failed", widget_id=w.id, error=str(exc)[:200]
                    )
                    chart = None
            else:
                chart = _widget_chart(log, ds_names)
        widget_responses.append(
            WidgetResponse(
                id=w.id,
                title=w.title,
                query_log_id=w.query_log_id,
                position_x=w.position_x,
                position_y=w.position_y,
                width=w.width,
                height=w.height,
                chart=chart,
            )
        )

    return DashboardResponse(
        id=dash.id,
        name=dash.name,
        description=dash.description,
        layout=dash.layout,
        global_filter=dash.global_filter,
        live_enabled=dash.live_enabled,
        live_interval_seconds=dash.live_interval_seconds,
        owned=False,
        widgets=widget_responses,
    )


def _chart_snapshot(
    log: QueryLog,
    columns: list[str],
    rows: list[dict[str, Any]],
    ds_names: dict[str, str],
) -> WidgetChart:
    """Assemble a WidgetChart from a log's metadata + explicit (columns, rows).

    Shared by the stored-snapshot path (_widget_chart) and the live/global-filter
    paths, which supply freshly-executed rows instead of log.result_data."""
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
        columns=columns,
        data=rows,
        insight=log.insight,
        sql=log.generated_sql,
        natural_language=log.natural_language,
        datasource_id=log.datasource_id,
        datasource_name=ds_names.get(log.datasource_id, "Demo") if log.datasource_id else "Demo",
    )


def _widget_chart(log: QueryLog | None, ds_names: dict[str, str]) -> WidgetChart | None:
    """Build the embedded render snapshot for a widget from its stored query log."""
    if log is None:
        return None
    result = log.result_data or {}
    return _chart_snapshot(log, result.get("columns", []), result.get("rows", []), ds_names)


async def load_widget_query_logs(
    db: AsyncSession, widgets: list[Widget], user_id: str
) -> dict[str, QueryLog]:
    """Batch-load the query logs behind widgets, SCOPED to ``user_id``.

    The user_id filter is security-relevant: a widget must never surface
    another user's data even if it references a foreign query_log_id. Every
    consumer of widget data (dashboard render, snapshots) must go through here.
    """
    log_ids = {w.query_log_id for w in widgets if w.query_log_id}
    if not log_ids:
        return {}
    rows = await db.execute(
        select(QueryLog).where(QueryLog.id.in_(log_ids), QueryLog.user_id == user_id)
    )
    return {q.id: q for q in rows.scalars().all()}


async def widgets_to_response(
    db: AsyncSession, widgets: list[Widget], user_id: str
) -> list[WidgetResponse]:
    """Serialize widgets, batch-loading query logs + datasources (no N+1)."""
    by_id = await load_widget_query_logs(db, widgets, user_id)

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


async def build_story(db: AsyncSession, user_id: str, dashboard_id: str) -> dict[str, Any]:
    """Generate a narrated data story for a dashboard (AI, with fallback)."""
    from app.ai import data_story

    dash = await get_dashboard(db, user_id, dashboard_id)
    widgets = await widgets_to_response(db, list(dash.widgets), user_id)
    payload = [
        {
            "widget_id": w.id,
            "title": w.title,
            "natural_language": w.chart.natural_language if w.chart else "",
            "chart_type": w.chart.chart_type if w.chart else "table",
            "insight": w.chart.insight if w.chart else "",
            "columns": w.chart.columns if w.chart else [],
            "rows": w.chart.data if w.chart else [],
        }
        for w in widgets
    ]
    return await data_story.build_story(dash.name, payload)


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
    from app.services import resource_share_service

    # Drop any workspace shares of this dashboard so no dangling share is left.
    await resource_share_service.purge_for_resource(db, "dashboard", dashboard_id)
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


async def refresh_widget_data(
    db: AsyncSession, widget: Widget, user_id: str, cache: CacheService | None = None
) -> WidgetChart | None:
    """Re-run a widget's stored SQL in place (no AI) and return the fresh chart.

    Reuses the existing QueryLog (same id, same chart_type/insight) and only
    swaps its ``result_data``. This is the cheap path live dashboards tick on —
    no chart re-selection, no insight regeneration, no new log rows.
    """
    if not widget.query_log_id:
        return None
    log = (
        await db.execute(
            select(QueryLog).where(
                QueryLog.id == widget.query_log_id, QueryLog.user_id == user_id
            )
        )
    ).scalar_one_or_none()
    if log is None:
        return None
    # RLS safety: live refresh runs as the dashboard OWNER and broadcasts one
    # dataset to the whole room. If the source is RLS-restricted, that dataset
    # would be owner-unfiltered — never push it to potentially-restricted viewers.
    if log.datasource_id:
        from app.services import rls_service

        if await rls_service.datasource_has_rules(db, log.datasource_id):
            return None
    columns, rows = await query_service.reexecute_logged_query(log, db, user_id, cache)
    log.result_data = {"columns": columns, "rows": query_service.snapshot_rows(rows)}
    await db.flush()

    ds_names: dict[str, str] = {}
    if log.datasource_id:
        row = await db.execute(
            select(DataSource.name).where(DataSource.id == log.datasource_id)
        )
        name = row.scalar_one_or_none()
        if name:
            ds_names[log.datasource_id] = name
    return _widget_chart(log, ds_names)


async def apply_global_filter(
    db: AsyncSession,
    user_id: str,
    dashboard_id: str,
    spec: dict[str, Any] | None,
    cache: CacheService | None = None,
    skip_rls: bool = False,
    restrict_to_widget_columns: bool = False,
) -> list[dict[str, Any]]:
    """Re-run every widget's stored SQL with the dashboard's global filter AND-ed
    in, returning fresh [{widget_id, chart}] — data-only, NO AI, NOT persisted.

    The stored ``result_data`` snapshot is left untouched (the filter is a view,
    not a mutation). Fail-open per widget: if one widget's filtered query errors
    (or its query doesn't reference a filter column), it falls back to its stored
    unfiltered chart so the dashboard never breaks. An empty ``spec`` returns the
    original, unfiltered charts (used to clear the filter).

    ``skip_rls`` is for the live BROADCAST path (one dataset fans out to the whole
    room including restricted guests): widgets on an RLS-restricted source are
    skipped (chart=None) so the owner's row scope never reaches a guest. The
    owner-only HTTP endpoint leaves it False (per-viewer RLS is applied normally).

    ``restrict_to_widget_columns`` (anonymous public/embed path) binds each
    widget only by columns it actually displays: a name shown by one widget can't
    slice a different widget's same-named but hidden base-table column."""
    from app.services import dashboard_filter_sql, rls_service

    dash = await get_dashboard(db, user_id, dashboard_id)
    widgets = list(dash.widgets)
    logs = await load_widget_query_logs(db, widgets, user_id)

    ds_ids = {q.datasource_id for q in logs.values() if q.datasource_id}
    ds_names: dict[str, str] = {}
    if ds_ids:
        rows = await db.execute(
            select(DataSource.id, DataSource.name).where(DataSource.id.in_(ds_ids))
        )
        ds_names = {ds_id: name for ds_id, name in rows.all()}

    # Clearing the filter (empty spec) returns the stored snapshots as-is — no
    # live re-execution, so numbers match what the user was viewing and we don't
    # hit the source once per widget for a no-op.
    if not dashboard_filter_sql.filter_active(spec):
        return [
            {"widget_id": w.id, "chart": _widget_chart(logs.get(w.query_log_id), ds_names)}
            for w in widgets
        ]

    out: list[dict[str, Any]] = []
    # Sequential on the shared session (an AsyncSession is not concurrent-safe);
    # dashboards hold few widgets so this stays fast.
    for w in widgets:
        log = logs.get(w.query_log_id) if w.query_log_id else None
        if log is None or not log.generated_sql:
            out.append({"widget_id": w.id, "chart": _widget_chart(log, ds_names)})
            continue
        if skip_rls and log.datasource_id and await rls_service.datasource_has_rules(db, log.datasource_id):
            # Don't fan an owner-scoped filtered dataset out to restricted guests.
            out.append({"widget_id": w.id, "chart": None})
            continue
        widget_spec = spec
        if restrict_to_widget_columns:
            result_cols = {str(c) for c in (log.result_data or {}).get("columns", [])}
            widget_spec = dashboard_filter_sql.narrow_spec_to_columns(spec, result_cols)
            if not dashboard_filter_sql.filter_active(widget_spec):
                # No displayed column of THIS widget is filtered — leave it on
                # its stored snapshot instead of binding to a hidden base column.
                out.append({"widget_id": w.id, "chart": _widget_chart(log, ds_names)})
                continue
        try:
            columns, rows_data = await query_service.reexecute_logged_query(
                log, db, user_id, cache, filter_spec=widget_spec
            )
            chart = _chart_snapshot(
                log, columns, query_service.snapshot_rows(rows_data), ds_names
            )
        except Exception as exc:  # fail-open: keep the widget on its stored data
            _log.warning("widget_filter_failed", widget_id=w.id, error=str(exc))
            chart = _widget_chart(log, ds_names)
        out.append({"widget_id": w.id, "chart": chart})
    return out


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
