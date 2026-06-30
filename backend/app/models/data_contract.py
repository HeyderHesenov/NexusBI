"""Data contract — schema/quality guarantees on a datasource table."""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


def _uuid() -> str:
    return str(uuid.uuid4())


class DataContract(Base, TimestampMixin):
    __tablename__ = "data_contracts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    datasource_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("datasources.id", ondelete="CASCADE"), index=True, nullable=False
    )
    table_name: Mapped[str] = mapped_column(String(255), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    # [{column, rule, params}] — rule ∈ not_null|unique|min|max|range|freshness|schema
    expectations: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    schema_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    last_status: Mapped[str] = mapped_column(String(12), nullable=False, default="unknown")  # pass|fail|unknown
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ContractRun(Base, TimestampMixin):
    __tablename__ = "contract_runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    contract_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("data_contracts.id", ondelete="CASCADE"), index=True, nullable=False
    )
    status: Mapped[str] = mapped_column(String(12), nullable=False)
    results: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
