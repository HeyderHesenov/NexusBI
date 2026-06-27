"""Dashboard comment (team chat) persistence."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.comment import DashboardComment
from app.models.dashboard import Widget


async def list_for_dashboard(
    db: AsyncSession, dashboard_id: str, limit: int = 200
) -> list[DashboardComment]:
    result = await db.execute(
        select(DashboardComment)
        .where(DashboardComment.dashboard_id == dashboard_id)
        .order_by(DashboardComment.created_at.asc())
        .limit(limit)
    )
    return list(result.scalars().all())


async def create(
    db: AsyncSession,
    dashboard_id: str,
    author_id: str | None,
    author_name: str,
    content: str,
    widget_id: str | None = None,
) -> DashboardComment:
    # Only attach widget_id if it belongs to this dashboard — a share-link guest
    # must not be able to reference another dashboard's widget.
    if widget_id:
        owned = await db.execute(
            select(Widget.id).where(
                Widget.id == widget_id, Widget.dashboard_id == dashboard_id
            )
        )
        if owned.scalar_one_or_none() is None:
            widget_id = None
    comment = DashboardComment(
        dashboard_id=dashboard_id,
        author_id=author_id,
        author_name=author_name[:120] or "Anonim",
        content=content[:2000],
        widget_id=widget_id,
    )
    db.add(comment)
    await db.flush()
    await db.refresh(comment)
    return comment
