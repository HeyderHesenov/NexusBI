"""Dashboard snapshot (time machine) schemas."""
from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class SnapshotCreate(BaseModel):
    label: str = Field(default="", max_length=120)


class SnapshotWidget(BaseModel):
    widget_id: str
    title: str
    chart_type: str
    chart_config: dict[str, Any]
    columns: list[str]
    rows: list[dict[str, Any]]


class SnapshotMeta(BaseModel):
    id: str
    label: str
    origin: str
    created_at: datetime

    model_config = {"from_attributes": True}


class SnapshotResponse(BaseModel):
    id: str
    label: str
    origin: str
    created_at: datetime
    widgets: list[SnapshotWidget]
