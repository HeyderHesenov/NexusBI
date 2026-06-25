"""User model."""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin


def _uuid() -> str:
    return str(uuid.uuid4())


class User(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    # Billing / rate limiting.
    subscription_tier: Mapped[str] = mapped_column(String(20), default="free", nullable=False)
    ai_calls_used: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    usage_period_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    datasources: Mapped[list["DataSource"]] = relationship(  # noqa: F821
        back_populates="user", cascade="all, delete-orphan"
    )
    dashboards: Mapped[list["Dashboard"]] = relationship(  # noqa: F821
        back_populates="user", cascade="all, delete-orphan"
    )
