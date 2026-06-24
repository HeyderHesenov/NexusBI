"""Dashboard and widget CRUD business logic."""
from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.exceptions import SchemaNotFoundError
from app.models.dashboard import Dashboard, Widget
from app.models.query_log import QueryLog
from app.schemas.dashboard import WidgetChart, WidgetResponse


async def create_dashboard(
    db: AsyncSession, user_id: str, name: str, description: str
) -> Dashboard:
    dash = Dashboard(user_id=user_id, name=name, description=description)
    db.add(dash)
    await db.flush()
    await db.refresh(dash)
    return dash


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


def _widget_chart(widget: Widget, log: QueryLog | None) -> WidgetChart | None:
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
    )


async def widgets_to_response(
    db: AsyncSession, widgets: list[Widget], user_id: str
) -> list[WidgetResponse]:
    """Serialize widgets, batch-loading their query logs in one query (no N+1).

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
    return [
        WidgetResponse(
            id=w.id,
            title=w.title,
            query_log_id=w.query_log_id,
            position_x=w.position_x,
            position_y=w.position_y,
            width=w.width,
            height=w.height,
            chart=_widget_chart(w, by_id.get(w.query_log_id) if w.query_log_id else None),
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
