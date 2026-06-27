"""Copilot chat schemas."""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class CopilotTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class CopilotRequest(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    history: list[CopilotTurn] = Field(default_factory=list, max_length=20)


class CopilotAction(BaseModel):
    type: str  # "query" | "dashboard" | "widget"
    label: str
    dashboard_id: str | None = None
    query_log_id: str | None = None


class CopilotResponse(BaseModel):
    reply: str
    actions: list[CopilotAction] = []
    steps: int = 0

    # Tool results may carry extra keys; ignore rather than reject.
    model_config = {"extra": "ignore"}

    @classmethod
    def from_result(cls, result: dict[str, Any]) -> "CopilotResponse":
        return cls(
            reply=result.get("reply", ""),
            actions=[CopilotAction(**a) for a in result.get("actions", [])],
            steps=result.get("steps", 0),
        )
