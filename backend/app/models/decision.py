"""Decision model — the Insight → Action → Outcome log.

The Decision Intelligence Loop layers a *closed loop* on top of this log: a
decision can be bound to a measurable metric (an NL query), its value captured
as a ``baseline`` at decision time and re-measured over time as ``realized`` —
so the app can hold its own recommendations accountable.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


def _uuid() -> str:
    return str(uuid.uuid4())


class Decision(Base, TimestampMixin):
    __tablename__ = "decisions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    # Optional link to the insight's source query.
    query_log_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("query_logs.id", ondelete="SET NULL"), nullable=True
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    insight: Mapped[str] = mapped_column(Text, nullable=False, default="")
    action: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # "open" | "in_progress" | "done"
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="open")
    outcome: Mapped[str] = mapped_column(Text, nullable=False, default="")

    # ─── Decision Intelligence Loop (all nullable so legacy rows stay valid) ───
    # The NL query that measures this decision's metric, and which column holds
    # the number (None → first numeric column of the result).
    metric_query: Mapped[str | None] = mapped_column(Text, nullable=True)
    metric_column: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # The source the metric runs against (None = demo / default).
    datasource_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("datasources.id", ondelete="SET NULL"), nullable=True
    )
    # What the decider expects the metric to do after the action.
    predicted_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    # "increase" | "decrease"
    predicted_direction: Mapped[str | None] = mapped_column(String(10), nullable=True)
    baseline_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    baseline_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    realized_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    realized_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # "off" | "daily" | "weekly" — cadence the scheduler re-measures on.
    measure_cadence: Mapped[str] = mapped_column(String(10), nullable=False, default="off")
    last_query_log_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("query_logs.id", ondelete="SET NULL"), nullable=True
    )
    # "pending" | "on_track" | "achieved" | "missed" | "regressed"
    impact_status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")


class DecisionMeasurement(Base):
    """A single point in a decision's metric trajectory (baseline + each re-measure)."""

    __tablename__ = "decision_measurements"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    decision_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("decisions.id", ondelete="CASCADE"), index=True, nullable=False
    )
    value: Mapped[float] = mapped_column(Float, nullable=False)
    measured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    query_log_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("query_logs.id", ondelete="SET NULL"), nullable=True
    )
