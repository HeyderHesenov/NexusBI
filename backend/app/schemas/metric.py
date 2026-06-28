"""Metric (semantic layer) schemas."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class MetricCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    expression: str = Field(default="", max_length=2000)
    description: str = Field(default="", max_length=2000)
    synonyms: str = Field(default="", max_length=500)
    datasource_id: str | None = None


class MetricVerifyRequest(BaseModel):
    verified: bool = True


class MetricResponse(BaseModel):
    id: str
    name: str
    expression: str
    description: str
    synonyms: str
    datasource_id: str | None
    verified: bool = False
    verified_by: str | None = None
    verified_at: datetime | None = None
    created_at: datetime

    model_config = {"from_attributes": True}
