"""Pydantic result types produced by the AI layer."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator

from app.ai import chart_format

ChartType = Literal["bar", "line", "pie", "scatter", "table", "kpi_card"]


class Text2SQLResult(BaseModel):
    sql: str
    explanation: str = ""
    confidence: float = Field(default=0.5, ge=0.0, le=1.0)
    warnings: list[str] = Field(default_factory=list)


class DAXResult(BaseModel):
    dax: str
    explanation: str = ""
    confidence: float = Field(default=0.5, ge=0.0, le=1.0)
    warnings: list[str] = Field(default_factory=list)


class ChartFormat(BaseModel):
    """Display-format hint for a chart's value column (see ai/chart_format.py)."""

    unit: str | None = None  # literal suffix appended after the number (e.g. "%")
    currency: str | None = None  # ISO 4217 code → currency styling on the client
    decimals: int | None = Field(default=None, ge=0, le=6)


class ChartConfig(BaseModel):
    chart_type: ChartType = "table"
    x_axis: str | None = None
    y_axis: str | None = None
    color_by: str | None = None
    reasoning: str = ""
    # Deterministic display hints. Optional so configs persisted before these
    # fields existed stay valid — the validator below backfills them on parse.
    format: ChartFormat | None = None
    x_label: str | None = None
    y_label: str | None = None

    @model_validator(mode="after")
    def _autofill_display_hints(self) -> "ChartConfig":
        """Fill format + axis labels from column names, never overwriting
        explicit values. Runs on EVERY construction — fresh AI selection,
        result cache, query history, dashboard snapshots — so configs saved
        before this feature existed are enriched when they are re-read."""
        if self.format is None:
            inferred = chart_format.infer_format(self.y_axis)
            if inferred:
                self.format = ChartFormat(**inferred)
        if self.x_label is None:
            self.x_label = chart_format.humanize(self.x_axis)
        if self.y_label is None:
            self.y_label = chart_format.humanize(self.y_axis)
        return self
