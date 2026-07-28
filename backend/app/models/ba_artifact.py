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
    # The source the evidence / BCG matrix was read from (None = demo model). Kept
    # as a real FK, not only inside `content`, because promoting an action hands it
    # straight to a Decision's own datasource_id.
    datasource_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("datasources.id", ondelete="SET NULL"), nullable=True
    )
    # Framework-shaped payload (see ai/ba_frameworks for each shape).
    #
    # NOTE: plain JSON, not MutableDict — SQLAlchemy does NOT see nested in-place
    # mutation. Anything writing into `content` must REASSIGN the whole dict
    # (see ba_service.promote) or the UPDATE is silently dropped.
    content: Mapped[dict] = mapped_column(JSON, nullable=False)
