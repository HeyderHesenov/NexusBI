"""Decision (Insight → Action → Outcome) schemas."""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

Status = Literal["open", "in_progress", "done"]


class DecisionCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    insight: str = Field(default="", max_length=4000)
    action: str = Field(default="", max_length=4000)
    query_log_id: str | None = None


class DecisionUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=255)
    action: str | None = Field(default=None, max_length=4000)
    status: Status | None = None
    outcome: str | None = Field(default=None, max_length=4000)


class DecisionResponse(BaseModel):
    id: str
    title: str
    insight: str
    action: str
    status: str
    outcome: str
    query_log_id: str | None
    created_at: datetime

    model_config = {"from_attributes": True}
