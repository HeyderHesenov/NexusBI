"""Schemas for anomaly detection and forecasting."""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class AnomalyPoint(BaseModel):
    label: str | None = None
    value: float | None = None
    severity: str = "medium"
    explanation: str = ""


class AnomalyResponse(BaseModel):
    anomalies: list[AnomalyPoint] = Field(default_factory=list)
    summary: str = ""
    label_col: str
    value_col: str
    method: str = "mad"  # "mad" | "mad+isolation_forest"


class ForecastPoint(BaseModel):
    label: str
    value: float | None = None
    lower: float | None = None
    upper: float | None = None


class ForecastRequest(BaseModel):
    periods: int = Field(default=6, ge=1, le=24)


class ForecastResponse(BaseModel):
    forecast: list[ForecastPoint] = Field(default_factory=list)
    narrative: str = ""
    label_col: str
    value_col: str
    method: str = ""  # "trend" | "trend+seasonalN" | "naive"
    history: list[dict[str, Any]] = Field(default_factory=list)


class RootCauseNode(BaseModel):
    label: str
    value: float | None = None
    contribution_pct: float | None = None
    direction: str = "up"  # "up" | "down"
    children: list["RootCauseNode"] = Field(default_factory=list)


class RootCauseResponse(BaseModel):
    metric: str = ""
    total: float | None = None
    summary: str = ""
    drivers: list[RootCauseNode] = Field(default_factory=list)


class LineageResponse(BaseModel):
    tables: list[str] = Field(default_factory=list)
    columns: list[str] = Field(default_factory=list)
    metrics: list[str] = Field(default_factory=list)


class SignificanceCheck(BaseModel):
    name: str
    passed: bool
    severity: str = "ok"  # "ok" | "warn"
    detail: str = ""


class SignificanceResponse(BaseModel):
    checks: list[SignificanceCheck] = Field(default_factory=list)
    summary: str = ""
