"""Dashboard and Widget models."""
from __future__ import annotations

import uuid

from sqlalchemy import JSON, Boolean, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin


def _uuid() -> str:
    return str(uuid.uuid4())


class Dashboard(Base, TimestampMixin):
    __tablename__ = "dashboards"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    layout: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # Dashboard-wide filter (date range + dimension slicers) persisted so the
    # selection survives reload; applied to every widget's SQL at query time.
    global_filter: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # Public read-only share link (null = not shared).
    share_token: Mapped[str | None] = mapped_column(
        String(64), unique=True, index=True, nullable=True
    )
    # Live mode: when on, the server re-runs widget queries on an interval and
    # pushes fresh data to connected clients over the collab WebSocket.
    live_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    live_interval_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=8)
    # Embedded analytics: signed read-only embed in external apps.
    embed_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    user: Mapped["User"] = relationship(back_populates="dashboards")  # noqa: F821
    widgets: Mapped[list["Widget"]] = relationship(
        back_populates="dashboard", cascade="all, delete-orphan"
    )


class Widget(Base, TimestampMixin):
    __tablename__ = "widgets"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    dashboard_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("dashboards.id", ondelete="CASCADE"), index=True, nullable=False
    )
    query_log_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("query_logs.id", ondelete="SET NULL"), nullable=True
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    position_x: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    position_y: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    width: Mapped[int] = mapped_column(Integer, default=4, nullable=False)
    height: Mapped[int] = mapped_column(Integer, default=4, nullable=False)

    dashboard: Mapped["Dashboard"] = relationship(back_populates="widgets")
