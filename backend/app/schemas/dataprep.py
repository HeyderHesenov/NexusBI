"""NL data-prep + profiling schemas."""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class DataPrepPreviewRequest(BaseModel):
    datasource_id: str | None = None
    instruction: str = Field(min_length=1, max_length=2000)


class DataPrepMaterializeRequest(BaseModel):
    datasource_id: str | None = None
    sql: str = Field(min_length=1, max_length=20000)
    name: str = Field(min_length=1, max_length=255)


class DataPrepPreviewResponse(BaseModel):
    sql: str
    steps: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    columns: list[str] = Field(default_factory=list)
    rows: list[dict[str, Any]] = Field(default_factory=list)


class ColumnProfile(BaseModel):
    column: str
    dtype: str
    null_pct: float
    distinct: int
    min: float | None = None
    max: float | None = None
    sample_size: int


class ProfileResponse(BaseModel):
    table: str
    row_sample: int
    columns: list[ColumnProfile] = Field(default_factory=list)
