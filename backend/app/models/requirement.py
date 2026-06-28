"""RequirementDoc model — a BRD/user-story turned into KPIs + a dashboard."""
from __future__ import annotations

import uuid

from sqlalchemy import JSON, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


def _uuid() -> str:
    return str(uuid.uuid4())


class RequirementDoc(Base, TimestampMixin):
    __tablename__ = "requirement_docs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    raw_text: Mapped[str] = mapped_column(Text, nullable=False, default="")
    extracted_kpis: Mapped[list | None] = mapped_column(JSON, nullable=True)
    dashboard_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("dashboards.id", ondelete="SET NULL"), nullable=True
    )
