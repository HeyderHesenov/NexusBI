"""Query history model."""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import JSON, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


def _uuid() -> str:
    return str(uuid.uuid4())


class QueryLog(Base, TimestampMixin):
    __tablename__ = "query_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    datasource_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("datasources.id", ondelete="SET NULL"), nullable=True
    )
    natural_language: Mapped[str] = mapped_column(Text, nullable=False)
    generated_sql: Mapped[str] = mapped_column(Text, nullable=False, default="")
    chart_type: Mapped[str] = mapped_column(String(50), nullable=False, default="table")
    chart_config: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    result_data: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    insight: Mapped[str] = mapped_column(Text, nullable=False, default="")
    execution_time_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Answer-trust signal computed by the pipeline. `provenance` is how the SQL/DAX
    # was produced: llm | deterministic_fallback (AI offline → rule-based) |
    # self_repaired (LLM SQL failed, repaired from the DB error) | user_sql (analyst
    # wrote it). NULL on rows logged before this feature → the UI shows no badge.
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    provenance: Mapped[str | None] = mapped_column(String(24), nullable=True)
    # When the ROWS were fetched — NOT when this row was written. `created_at`
    # answers the second question and the two come apart in both directions:
    # query_service._finalize persists a cache hit under a FRESH log, so the rows
    # can be CACHE_TTL_SECONDS older than created_at; dashboard_service
    # .refresh_widget_data rewrites an existing log's rows IN PLACE, so they can
    # be newer. Anything presenting a number's age (metric_tree_service) must read
    # this, not the run stamp.
    #
    # NULL on rows written before this column existed, and on a cache entry that
    # was already in flight when it shipped — readers fall back to the run stamp,
    # which is what they did before. Deliberately not backfilled: writing
    # created_at into old rows would MATERIALISE the overstatement being fixed for
    # every one of them that was a cache hit.
    data_as_of: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
