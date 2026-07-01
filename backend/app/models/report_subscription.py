"""ReportSubscription — scheduled PDF/Excel delivery of a saved query by email."""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


def _uuid() -> str:
    return str(uuid.uuid4())


class ReportSubscription(Base, TimestampMixin):
    __tablename__ = "report_subscriptions"
    # The scheduler scans active subscriptions and checks each one's cadence.
    __table_args__ = (
        Index("ix_report_subscriptions_active_last_sent", "active", "last_sent_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    saved_query_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("saved_queries.id", ondelete="CASCADE"), index=True, nullable=False
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    recipient: Mapped[str] = mapped_column(String(320), nullable=False)
    format: Mapped[str] = mapped_column(String(10), nullable=False, default="pdf")  # pdf | xlsx
    schedule: Mapped[str] = mapped_column(String(20), nullable=False, default="daily")
    last_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
