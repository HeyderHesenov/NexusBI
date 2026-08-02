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


# Row-level security posture of a source (see DataSource.rls_mode).
RLS_OPEN = "open"
RLS_STRICT = "strict"


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

    # Deny-by-default switch. "open" = a member with no RLS rule sees every row
    # (the original behaviour); "strict" = a member with no rule sees NO rows.
    # The owner is never constrained by either mode.
    #
    # Both defaults are "strict" now and must stay in step: relying on the Python
    # one alone would leave every non-ORM INSERT (bulk import, ops fix, a cloning
    # migration) fail-OPEN. Rows that predate the column keep the "open" they were
    # backfilled with in f3a4b5c6d7e8 — an installed source must not change
    # behaviour under a migration — and a0b1c2d3e4f5 moved the default off it.
    # Plain String, not Enum() — an Enum would create a Postgres type that the
    # SQLite path can't mirror, and every expression here must run on both.
    rls_mode: Mapped[str] = mapped_column(
        String(16), nullable=False, default=RLS_STRICT, server_default=RLS_OPEN
    )

    # Freshness SLA (trust layer): how recent the data is expected to be, plus the
    # last time we successfully reached the source.
    freshness_sla_hours: Mapped[int | None] = mapped_column(Integer, nullable=True)
    last_refreshed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped["User"] = relationship(back_populates="datasources")  # noqa: F821
