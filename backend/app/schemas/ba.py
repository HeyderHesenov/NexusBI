"""BA Framework Studio schemas."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.schemas.decision import DecisionResponse

Framework = Literal["swot", "porter", "bcg", "bpmn"]

# Mirrors ba_frameworks._MAX_ACTIONS: an artifact never carries more than 5.
MAX_ACTION_INDEX = 4


class BAGenerateRequest(BaseModel):
    framework: Framework
    title: str = Field(default="", max_length=255)
    context: str = Field(default="", max_length=8000)
    # None = the demo model (demo mode only); otherwise a connected source, whose
    # facts and BCG matrix are read through the usual guarded chain.
    datasource_id: str | None = None


class BAArtifactResponse(BaseModel):
    id: str
    framework: str
    title: str
    context: str
    content: dict[str, Any]
    created_at: datetime
    datasource_id: str | None = None


class BAPromoteRequest(BaseModel):
    action_index: int = Field(ge=0, le=MAX_ACTION_INDEX)


class BAPromoteResponse(BaseModel):
    """The created (or already-linked) decision plus the artifact that now cites it.

    Returning both keeps the client from having to synthesise the ``decision_id``
    it just caused — the store swaps in the server's artifact instead of guessing.
    """

    decision: DecisionResponse
    artifact: BAArtifactResponse
