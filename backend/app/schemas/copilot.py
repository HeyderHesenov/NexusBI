"""Copilot chat schemas."""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class CopilotTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class CopilotPlanStep(BaseModel):
    tool: str = ""
    summary: str = ""

    model_config = {"extra": "ignore"}


class CopilotRequest(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    history: list[CopilotTurn] = Field(default_factory=list, max_length=20)
    # "plan" → propose steps without executing; "execute" → run the tool loop.
    mode: Literal["plan", "execute"] = "execute"
    # The approved plan (from a prior plan turn), forwarded on execute so the run
    # follows what the user approved.
    plan: list[CopilotPlanStep] = Field(default_factory=list, max_length=20)


class CopilotAction(BaseModel):
    # query | dashboard | widget | share | saved_query | metric | digest |
    # ml_model | ba_artifact | decision | contract | insight |
    # metric_tree | snapshot | alert
    type: str
    label: str
    dashboard_id: str | None = None
    query_log_id: str | None = None
    saved_query_id: str | None = None
    metric_id: str | None = None
    ml_model_id: str | None = None
    ba_artifact_id: str | None = None
    decision_id: str | None = None
    contract_id: str | None = None

    # Tolerate extra id keys future tools may emit.
    model_config = {"extra": "ignore"}


class CopilotResponse(BaseModel):
    reply: str
    actions: list[CopilotAction] = []
    plan: list[CopilotPlanStep] = []
    steps: int = 0

    # Tool results may carry extra keys; ignore rather than reject.
    model_config = {"extra": "ignore"}

    @classmethod
    def from_result(cls, result: dict[str, Any]) -> "CopilotResponse":
        return cls(
            reply=result.get("reply", ""),
            actions=[CopilotAction(**a) for a in result.get("actions", [])],
            plan=[CopilotPlanStep(**s) for s in result.get("plan", [])],
            steps=result.get("steps", 0),
        )
