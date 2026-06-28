"""DataSource connection model."""
from __future__ import annotations

import enum
import uuid
from datetime import datetime

from sqlalchemy import JSON, DateTime, Enum, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin


def _uuid() -> str:
    return str(uuid.uuid4())


class DBType(str, enum.Enum):
    postgresql = "postgresql"
    mysql = "mysql"
    sqlite = "sqlite"
    powerbi = "powerbi"


class DataSource(Base, TimestampMixin):
    __tablename__ = "datasources"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    db_type: Mapped[DBType] = mapped_column(Enum(DBType), nullable=False)
    connection_string_encrypted: Mapped[str] = mapped_column(Text, nullable=False)
    schema_cache: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    # Freshness SLA (trust layer): how recent the data is expected to be, plus the
    # last time we successfully reached the source.
    freshness_sla_hours: Mapped[int | None] = mapped_column(Integer, nullable=True)
    last_refreshed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped["User"] = relationship(back_populates="datasources")  # noqa: F821
