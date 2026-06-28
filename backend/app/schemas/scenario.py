"""Scenario planning schemas: KPI targets, goal-seek, Monte Carlo."""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

Period = Literal["month", "quarter", "year"]


class KPITargetCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    target_value: float = Field(gt=0)
    current_value: float = 0.0
    period: Period = "month"
    period_start: datetime | None = None


class KPITargetUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=255)
    target_value: float | None = Field(default=None, gt=0)
    current_value: float | None = None
    period: Period | None = None
    period_start: datetime | None = None


class Pacing(BaseModel):
    attainment_pct: float
    elapsed_pct: float
    expected_value: float
    on_track: bool
    status: str


class KPITargetResponse(BaseModel):
    id: str
    name: str
    target_value: float
    current_value: float
    period: str
    period_start: datetime | None
    created_at: datetime
    pacing: Pacing


class GoalSeekRequest(BaseModel):
    target: float


class GoalSeekResponse(BaseModel):
    current: float
    total: float
    target: float
    gap: float
    required_pct: float | None = None


class MonteCarloRequest(BaseModel):
    periods: int = Field(default=6, ge=1, le=36)
    runs: int = Field(default=1000, ge=100, le=5000)


class MonteCarloBand(BaseModel):
    period: int
    p10: float
    p50: float
    p90: float


class MonteCarloResponse(BaseModel):
    start: float
    mean_return_pct: float
    bands: list[MonteCarloBand] = Field(default_factory=list)
