"""BAArtifact — a saved BA Framework Studio output (SWOT / Porter / BCG / BPMN)."""
from __future__ import annotations

import uuid

from sqlalchemy import JSON, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


def _uuid() -> str:
    return str(uuid.uuid4())


class BAArtifact(Base, TimestampMixin):
    __tablename__ = "ba_artifacts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    # "swot" | "porter" | "bcg" | "bpmn"
    framework: Mapped[str] = mapped_column(String(20), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    # The business context the user supplied (kept so artifacts are reproducible).
    context: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # Framework-shaped payload (see ai/ba_frameworks for each shape).
    content: Mapped[dict] = mapped_column(JSON, nullable=False)
