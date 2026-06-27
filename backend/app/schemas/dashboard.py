"""Dashboard and widget schemas."""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class WidgetCreate(BaseModel):
    query_log_id: str
    title: str = Field(default="", max_length=255)
    position_x: int = 0
    position_y: int = 0
    width: int = 4
    height: int = 4


class WidgetChart(BaseModel):
    """Rendered snapshot of the linked query, embedded so the dashboard renders
    in a single request (no per-widget round trips)."""

    chart_type: str
    chart_config: dict[str, Any] = Field(default_factory=dict)
    columns: list[str] = []
    data: list[dict[str, Any]] = []
    insight: str = ""
    sql: str = ""
    natural_language: str = ""
    datasource_id: str | None = None
    datasource_name: str = "Demo"


class WidgetResponse(BaseModel):
    id: str
    title: str
    query_log_id: str | None
    position_x: int
    position_y: int
    width: int
    height: int
    chart: WidgetChart | None = None

    model_config = {"from_attributes": True}


class DashboardCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str = Field(default="", max_length=2000)


class DashboardGenerate(BaseModel):
    goal: str = Field(min_length=1, max_length=500)
    datasource_id: str | None = None


class DashboardUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=255)
    description: str | None = Field(default=None, max_length=2000)
    layout: dict[str, Any] | None = None


class DashboardLiveUpdate(BaseModel):
    enabled: bool
    # Clamp the cadence so a client can't ask the server to hammer the source.
    interval_seconds: int | None = Field(default=None, ge=3, le=3600)


class DashboardResponse(BaseModel):
    id: str
    name: str
    description: str
    layout: dict[str, Any] | None = None
    live_enabled: bool = False
    live_interval_seconds: int = 8
    widgets: list[WidgetResponse] = []

    model_config = {"from_attributes": True}


class DashboardSummary(BaseModel):
    id: str
    name: str
    description: str

    model_config = {"from_attributes": True}


class StorySlide(BaseModel):
    type: str  # "intro" | "chart" | "closing"
    title: str
    narrative: str = ""
    widget_id: str | None = None


class DataStory(BaseModel):
    title: str
    slides: list[StorySlide] = []
