"""Auto-discovered insight — ranked finding from the insight engine's scan."""
from __future__ import annotations

import uuid

from sqlalchemy import Boolean, Float, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


def _uuid() -> str:
    return str(uuid.uuid4())


class Insight(Base, TimestampMixin):
    __tablename__ = "insights"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    query_log_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("query_logs.id", ondelete="SET NULL"), nullable=True
    )
    kind: Mapped[str] = mapped_column(String(24), nullable=False)  # dominance|outlier|concentration
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False, default="")
    impact_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    dedup_key: Mapped[str] = mapped_column(String(255), nullable=False, default="", index=True)
    dismissed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
