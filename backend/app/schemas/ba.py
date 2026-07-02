"""BA Framework Studio schemas."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

Framework = Literal["swot", "porter", "bcg", "bpmn"]


class BAGenerateRequest(BaseModel):
    framework: Framework
    title: str = Field(default="", max_length=255)
    context: str = Field(default="", max_length=8000)


class BAArtifactResponse(BaseModel):
    id: str
    framework: str
    title: str
    context: str
    content: dict[str, Any]
    created_at: datetime
