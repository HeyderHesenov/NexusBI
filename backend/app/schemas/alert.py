"""Alert (monitor) + Notification schemas."""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

Operator = Literal[">", "<", ">=", "<=", "==", "!="]
ConditionType = Literal["static", "anomaly"]


class AlertCreate(BaseModel):
    saved_query_id: str
    name: str = Field(min_length=1, max_length=255)
    column: str = Field(min_length=1, max_length=255)
    # "anomaly" alerts ignore operator/threshold (they fire on a statistical outlier).
    condition_type: ConditionType = "static"
    operator: Operator = ">"
    threshold: float = 0.0
    # Minutes of silence after a breach; 0 = notify on every evaluation. Capped at
    # a week, past which "muted" is the honest word and `active` is the control.
    cooldown_minutes: int = Field(60, ge=0, le=10080)


class AlertUpdate(BaseModel):
    """Partial edit. Every field optional — an omitted field is left untouched,
    which is what lets the UI's pause toggle send `active` alone."""

    name: str | None = Field(None, min_length=1, max_length=255)
    active: bool | None = None
    cooldown_minutes: int | None = Field(None, ge=0, le=10080)
    threshold: float | None = None


class AlertResponse(BaseModel):
    id: str
    saved_query_id: str
    name: str
    column: str
    condition_type: str
    operator: str
    threshold: float
    active: bool
    cooldown_minutes: int
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
