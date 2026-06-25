"""SavedQuery model — a named NL query, optionally on a refresh schedule."""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


def _uuid() -> str:
    return str(uuid.uuid4())


class SavedQuery(Base, TimestampMixin):
    __tablename__ = "saved_queries"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    nl_query: Mapped[str] = mapped_column(Text, nullable=False)
    datasource_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("datasources.id", ondelete="SET NULL"), nullable=True
    )
    # "off" | "hourly" | "daily" | "weekly"
    schedule: Mapped[str] = mapped_column(String(20), default="off", nullable=False)
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_query_log_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("query_logs.id", ondelete="SET NULL"), nullable=True
    )
