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


class WidgetResponse(BaseModel):
    id: str
    title: str
    query_log_id: str | None
    position_x: int
    position_y: int
    width: int
    height: int

    model_config = {"from_attributes": True}


class DashboardCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str = Field(default="", max_length=2000)


class DashboardUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=255)
    description: str | None = Field(default=None, max_length=2000)
    layout: dict[str, Any] | None = None


class DashboardResponse(BaseModel):
    id: str
    name: str
    description: str
    layout: dict[str, Any] | None = None
    widgets: list[WidgetResponse] = []

    model_config = {"from_attributes": True}


class DashboardSummary(BaseModel):
    id: str
    name: str
    description: str

    model_config = {"from_attributes": True}
