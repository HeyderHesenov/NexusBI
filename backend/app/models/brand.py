"""BrandConfig model — per-user white-label settings for embeds/public views."""
from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


def _uuid() -> str:
    return str(uuid.uuid4())


class BrandConfig(Base, TimestampMixin):
    __tablename__ = "brand_configs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), unique=True, index=True, nullable=False
    )
    app_name: Mapped[str] = mapped_column(String(120), nullable=False, default="NexusBI")
    primary_color: Mapped[str] = mapped_column(String(9), nullable=False, default="#0E9F6E")
    logo_url: Mapped[str] = mapped_column(String(2000), nullable=False, default="")
