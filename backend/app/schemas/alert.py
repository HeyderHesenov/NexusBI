"""Alert (monitor) + Notification schemas."""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

Operator = Literal[">", "<", ">=", "<=", "==", "!="]


class AlertCreate(BaseModel):
    saved_query_id: str
    name: str = Field(min_length=1, max_length=255)
    column: str = Field(min_length=1, max_length=255)
    operator: Operator
    threshold: float = 0.0


class AlertResponse(BaseModel):
    id: str
    saved_query_id: str
    name: str
    column: str
    operator: str
    threshold: float
    active: bool
    last_triggered_at: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}


class NotificationResponse(BaseModel):
    id: str
    title: str
    body: str
    read: bool
    category: str
    alert_id: str | None
    created_at: datetime

    model_config = {"from_attributes": True}
