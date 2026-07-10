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
    # Every candidate algorithm tried + its score (best flagged). Empty for models
    # trained before diagnostics existed.
    leaderboard: list[dict[str, Any]] = Field(default_factory=list)
    # k-fold CV, confusion matrix / actual-vs-predicted, permutation importance, and
    # per-prediction explain stats. Empty for pre-diagnostics models.
    diagnostics: dict[str, Any] = Field(default_factory=dict)
    sklearn_version: str
    row_count: int
    created_at: datetime


class PredictRequest(BaseModel):
    rows: list[dict[str, Any]] = Field(min_length=1, max_length=100)


class PredictResponse(BaseModel):
    predictions: list[Any]
    # Per prediction, the few features that most influenced it (model importance ×
    # how unusual the input value is). Parallel to ``predictions``; may be empty for
    # models trained before explain stats existed.
    explanations: list[list[dict[str, Any]]] = Field(default_factory=list)


class AutoMLTableColumn(BaseModel):
    name: str
    dtype: str


class AutoMLTable(BaseModel):
    name: str
    columns: list[AutoMLTableColumn]
