"""Integration channel schemas."""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class IntegrationCreate(BaseModel):
    type: Literal["slack", "teams", "email"]
    name: str = Field(default="", max_length=255)
    target: str = Field(min_length=3, max_length=2000)  # webhook URL or email


class IntegrationResponse(BaseModel):
    id: str
    type: str
    name: str
    active: bool
    created_at: datetime

    # Never expose the encrypted target.
    model_config = {"from_attributes": True}
