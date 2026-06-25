"""Decision model — the Insight → Action → Outcome log."""
from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


def _uuid() -> str:
    return str(uuid.uuid4())


class Decision(Base, TimestampMixin):
    __tablename__ = "decisions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    # Optional link to the insight's source query.
    query_log_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("query_logs.id", ondelete="SET NULL"), nullable=True
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    insight: Mapped[str] = mapped_column(Text, nullable=False, default="")
    action: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # "open" | "in_progress" | "done"
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="open")
    outcome: Mapped[str] = mapped_column(Text, nullable=False, default="")
