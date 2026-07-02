"""AutoML schemas. ``model_blob`` is intentionally absent from every schema."""
from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class TrainRequest(BaseModel):
    name: str = Field(default="", max_length=255)
    source_table: str = Field(min_length=1, max_length=255)
    datasource_id: str | None = None
    target_column: str = Field(min_length=1, max_length=255)


class MLModelOut(BaseModel):
    id: str
    name: str
    source_table: str
    datasource_id: str | None
    target_column: str
    feature_columns: list[str]
    problem_type: str
    best_algo: str
    metrics: dict[str, float]
    importances: list[dict[str, Any]]
    sklearn_version: str
    row_count: int
    created_at: datetime


class PredictRequest(BaseModel):
    rows: list[dict[str, Any]] = Field(min_length=1, max_length=100)


class PredictResponse(BaseModel):
    predictions: list[Any]


class AutoMLTableColumn(BaseModel):
    name: str
    dtype: str


class AutoMLTable(BaseModel):
    name: str
    columns: list[AutoMLTableColumn]
