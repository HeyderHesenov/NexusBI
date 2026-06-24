"""Pydantic result types produced by the AI layer."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

ChartType = Literal["bar", "line", "pie", "scatter", "table", "kpi_card"]


class Text2SQLResult(BaseModel):
    sql: str
    explanation: str = ""
    confidence: float = Field(default=0.5, ge=0.0, le=1.0)
    warnings: list[str] = Field(default_factory=list)


class ChartConfig(BaseModel):
    chart_type: ChartType = "table"
    x_axis: str | None = None
    y_axis: str | None = None
    color_by: str | None = None
    reasoning: str = ""
