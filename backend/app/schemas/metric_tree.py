"""Metric tree (KPI decomposition) schemas."""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

Operator = Literal["add", "sub", "mul", "div"]


class MetricNodeCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    parent_id: str | None = None
    operator: Operator = "add"
    manual_value: float | None = None
    position: int = 0


class MetricNodeUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=255)
    operator: Operator | None = None
    manual_value: float | None = None
    position: int | None = None


class MetricNodeResponse(BaseModel):
    id: str
    parent_id: str | None
    name: str
    operator: str
    manual_value: float | None
    position: int
    created_at: datetime

    model_config = {"from_attributes": True}


class EvaluatedNode(BaseModel):
    id: str
    name: str
    operator: str
    value: float
    manual_value: float | None = None  # the stored leaf value (for editing)
    contribution_pct: float | None = None
    children: list["EvaluatedNode"] = Field(default_factory=list)
