"""AI quality / observability schemas."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class EvalCaseDetail(BaseModel):
    nl: str
    passed: bool
    strict_passed: bool
    latency_ms: int = 0
    tier: str = "easy"


class EvalRunResponse(BaseModel):
    id: str
    model: str
    total: int
    passed: int
    exec_accuracy: float
    avg_latency_ms: float
    notes: str
    details: list[EvalCaseDetail] = []
    created_at: datetime

    model_config = {"from_attributes": True}


class ObservabilitySummary(BaseModel):
    calls: int
    total_tokens: int
    avg_latency_ms: float
    by_kind: dict[str, int]


class ReindexResult(BaseModel):
    indexed: int
