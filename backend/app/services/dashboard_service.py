"""Dashboard and widget CRUD business logic."""
from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.exceptions import SchemaNotFoundError
from app.models.dashboard import Dashboard, Widget


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
