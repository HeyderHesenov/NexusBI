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
    # WHERE THIS POINT SITS ON THE DECISION'S TIMELINE — not how old its data is.
    # counterfactual() splits pre/post history on `measured_at < baseline_at`, so
    # this must keep answering "when was this recorded", or a baseline taken from
    # an older query would silently move itself into the pre-decision history and
    # change which counterfactual method runs.
    measured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    # HOW OLD THE DATA BEHIND `value` WAS — the other question, kept apart for the
    # reason above. The two come apart whenever a measurement is not a live run:
    # _capture_baseline reuses the spawning query's STORED result (no re-run, so
    # the number can be hours old while the decision is being made now), and
    # process_nl_query can serve that query from cache. `_measure` genuinely
    # re-executes, so there the two agree.
    #
    # NULL means UNKNOWN, and a live writer can still produce it: a row from
    # before this column existed, a baseline lifted from a log that predates
    # QueryLog.data_as_of, or a cache entry that was already in flight when that
    # stamp shipped. So NULL is not a reliable "this is a legacy row" marker —
    # it is only ever "we do not know", and must never be read as "same as
    # measured_at". Deliberately not backfilled: copying `measured_at` in would
    # assert the very equality this column exists to stop assuming.
    data_as_of: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    query_log_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("query_logs.id", ondelete="SET NULL"), nullable=True
    )
