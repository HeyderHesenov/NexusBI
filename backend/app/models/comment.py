"""Dashboard comment (team chat) model."""
from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


def _uuid() -> str:
    return str(uuid.uuid4())


class DashboardComment(Base, TimestampMixin):
    """A chat message on a dashboard. ``author_id`` is null for share-link guests;
    ``author_name`` is always stored so messages render without a user lookup."""

    __tablename__ = "dashboard_comments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    dashboard_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("dashboards.id", ondelete="CASCADE"), index=True, nullable=False
    )
    widget_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("widgets.id", ondelete="SET NULL"), nullable=True
    )
    author_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    author_name: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    content: Mapped[str] = mapped_column(Text, nullable=False)
