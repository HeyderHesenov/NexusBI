"""Dashboard comment (team chat) schemas."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class CommentResponse(BaseModel):
    id: str
    dashboard_id: str
    widget_id: str | None
    author_id: str | None
    author_name: str
    content: str
    created_at: datetime

    model_config = {"from_attributes": True}


class CommentCreate(BaseModel):
    content: str = Field(min_length=1, max_length=2000)
    widget_id: str | None = None
