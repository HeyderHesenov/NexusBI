"""Saved graph views — CRUD for user-curated overlays over the derived graph.

Kept separate from ``graph_service`` so that module stays a pure, deterministic
read-only composer. A view only stores a filter config (included / hidden ids);
the frontend applies it to the single derived graph payload.
"""
from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import SchemaNotFoundError
from app.models.graph_view import GraphView


async def list_views(db: AsyncSession, user_id: str) -> list[GraphView]:
    res = await db.execute(
        select(GraphView)
        .where(GraphView.user_id == user_id)
        .order_by(GraphView.created_at.asc())
    )
    return list(res.scalars().all())


async def _get_owned(db: AsyncSession, user_id: str, view_id: str) -> GraphView:
    res = await db.execute(
        select(GraphView).where(GraphView.id == view_id, GraphView.user_id == user_id)
    )
    view = res.scalar_one_or_none()
    if view is None:
        raise SchemaNotFoundError("Qrafik görünüşü tapılmadı.")
    return view


async def create_view(
    db: AsyncSession,
    user_id: str,
    *,
    name: str,
    included_node_ids: list[str] | None = None,
    hidden_node_ids: list[str] | None = None,
    hidden_edge_keys: list[str] | None = None,
) -> GraphView:
    view = GraphView(
        user_id=user_id,
        name=name,
        included_node_ids=included_node_ids,
        hidden_node_ids=hidden_node_ids or [],
        hidden_edge_keys=hidden_edge_keys or [],
    )
    db.add(view)
    await db.flush()
    await db.refresh(view)
    return view


async def update_view(
    db: AsyncSession, user_id: str, view_id: str, changes: dict[str, Any]
) -> GraphView:
    """Apply already-``exclude_unset`` changes (name / included / hidden arrays)."""
    view = await _get_owned(db, user_id, view_id)
    for field, value in changes.items():
        setattr(view, field, value)
    await db.flush()
    await db.refresh(view)
    return view


async def delete_view(db: AsyncSession, user_id: str, view_id: str) -> None:
    view = await _get_owned(db, user_id, view_id)
    await db.delete(view)
    await db.flush()
