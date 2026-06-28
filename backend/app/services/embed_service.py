"""Embedded analytics: signed read-only embed tokens for dashboards."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.exceptions import SchemaNotFoundError
from app.core.security import create_embed_token, decode_embed_token
from app.models.dashboard import Dashboard
from app.services import dashboard_service


async def set_embed(
    db: AsyncSession, user_id: str, dashboard_id: str, enabled: bool
) -> tuple[Dashboard, str | None]:
    """Toggle embedding; returns (dashboard, token) — token only when enabled."""
    dash = await dashboard_service.get_dashboard(db, user_id, dashboard_id)
    dash.embed_enabled = enabled
    await db.flush()
    token = create_embed_token(dashboard_id) if enabled else None
    return dash, token


async def resolve(db: AsyncSession, token: str) -> Dashboard:
    """Load a dashboard from an embed token; 404 if embedding is disabled."""
    dashboard_id = decode_embed_token(token)  # raises AuthError if bad/expired
    res = await db.execute(
        select(Dashboard)
        .where(Dashboard.id == dashboard_id)
        .options(selectinload(Dashboard.widgets))
    )
    dash = res.scalar_one_or_none()
    if dash is None or not dash.embed_enabled:
        raise SchemaNotFoundError("Embed tapılmadı və ya söndürülüb.")
    return dash
