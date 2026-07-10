"""Decision (Insight → Action → Outcome) schemas + Decision Intelligence Loop."""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

Status = Literal["open", "in_progress", "done"]
Direction = Literal["increase", "decrease"]
Cadence = Literal["off", "daily", "weekly"]


class DecisionCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    insight: str = Field(default="", max_length=4000)
    action: str = Field(default="", max_length=4000)
    query_log_id: str | None = None
    # Decision Intelligence Loop binding (all optional).
    metric_query: str | None = Field(default=None, max_length=2000)
    metric_column: str | None = Field(default=None, max_length=255)
    datasource_id: str | None = None
    predicted_value: float | None = None
    predicted_direction: Direction | None = None
    measure_cadence: Cadence | None = None


class DecisionUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=255)
    action: str | None = Field(default=None, max_length=4000)
    status: Status | None = None
    outcome: str | None = Field(default=None, max_length=4000)
    metric_query: str | None = Field(default=None, max_length=2000)
    metric_column: str | None = Field(default=None, max_length=255)
    predicted_value: float | None = None
    predicted_direction: Direction | None = None
    measure_cadence: Cadence | None = None


class DecisionResponse(BaseModel):
    id: str
    title: str
    insight: str
    action: str
    status: str
    outcome: str
    query_log_id: str | None
    created_at: datetime
    # Decision Intelligence Loop.
    metric_query: str | None
    metric_column: str | None
    datasource_id: str | None
    predicted_value: float | None
    predicted_direction: str | None
    baseline_value: float | None
    baseline_at: datetime | None
    realized_value: float | None
    realized_at: datetime | None
    measure_cadence: str
    impact_status: str

    model_config = {"from_attributes": True}


class DecisionMeasurementResponse(BaseModel):
    id: str
    value: float
    measured_at: datetime
    query_log_id: str | None

    model_config = {"from_attributes": True}


class CounterfactualBand(BaseModel):
    measured_at: datetime
    yhat: float
    lower: float
    upper: float


class Counterfactual(BaseModel):
    # "baseline" = no usable pre-history, absolute change vs baseline (NOT a true
    # counterfactual); otherwise the stats.forecast_series method that produced band.
    method: str
    band: list[CounterfactualBand] | None = None
    counterfactual_value: float | None = None
    delta_vs_counterfactual: float | None = None


class DecisionROI(BaseModel):
    decision_id: str
    baseline_value: float | None
    predicted_value: float | None
    realized_value: float | None
    predicted_direction: str | None
    delta_abs: float | None
    delta_pct: float | None
    progress_pct: float | None
    impact_status: str
    baseline_at: datetime | None
    realized_at: datetime | None
    counterfactual: Counterfactual | None = None


class DecisionTrajectory(BaseModel):
    points: list[DecisionMeasurementResponse]
    counterfactual: Counterfactual | None = None


class AccuracySummary(BaseModel):
    total_measured: int
    direction_hit_rate: float | None
    achieved: int
    accuracy_pct: float | None
    avg_magnitude_error_pct: float | None
