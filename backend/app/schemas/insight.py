"""Insight engine schemas."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class InsightResponse(BaseModel):
    id: str
    kind: str
    title: str
    body: str
    impact_score: float
    query_log_id: str | None
    dismissed: bool
    created_at: datetime

    model_config = {"from_attributes": True}
