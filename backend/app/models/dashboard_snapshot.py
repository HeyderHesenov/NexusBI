"""Dashboard snapshot — a point-in-time copy of every widget's data (time machine)."""
from __future__ import annotations

import uuid

from sqlalchemy import JSON, ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


def _uuid() -> str:
    return str(uuid.uuid4())


class DashboardSnapshot(Base, TimestampMixin):
    """Append-only capture of a dashboard's widget data.

    ``payload`` = ``{"widgets": [{widget_id, title, chart_type, chart_config,
    columns, rows}]}`` with rows capped per widget. ``created_at`` (from
    TimestampMixin) doubles as the capture time. The snapshot records the
    PERSISTED truth (each widget's stored query_log result) — not whatever a
    live WebSocket refresh may have painted on screen.
    """

    __tablename__ = "dashboard_snapshots"
    __table_args__ = (Index("ix_dashboard_snapshots_dash_created", "dashboard_id", "created_at"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    dashboard_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("dashboards.id", ondelete="CASCADE"), index=True, nullable=False
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    label: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    origin: Mapped[str] = mapped_column(String(10), nullable=False, default="manual")  # manual|scheduled
    payload: Mapped[dict] = mapped_column(JSON, nullable=False)
