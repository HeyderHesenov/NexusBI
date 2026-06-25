"""SavedQuery request/response schemas."""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

Schedule = Literal["off", "hourly", "daily", "weekly"]


class SavedQueryCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    nl_query: str = Field(min_length=1, max_length=2000)
    datasource_id: str | None = None
    schedule: Schedule = "off"


class SavedQueryUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    schedule: Schedule | None = None


class SavedQueryResponse(BaseModel):
    id: str
    name: str
    nl_query: str
    datasource_id: str | None
    schedule: str
    last_run_at: datetime | None
    last_query_log_id: str | None
    created_at: datetime

    model_config = {"from_attributes": True}
