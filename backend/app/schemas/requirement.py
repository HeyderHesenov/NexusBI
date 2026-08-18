"""Requirements → dashboard schemas."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.decision import DecisionResponse, Direction


class KpiItem(BaseModel):
    name: str = ""
    question: str = ""
    rationale: str = ""
    requirement_ref: str = ""
    # The acceptance criterion, PROPOSED by extraction and confirmed by the user
    # at promote time. Null is the normal case: most requirement lines state a
    # metric without stating a number, and extraction is forbidden from guessing.
    target_value: float | None = None
    direction: Direction | None = None


class RequirementExtractRequest(BaseModel):
    name: str = Field(default="", max_length=255)
    text: str = Field(min_length=1, max_length=20000)


class RequirementBuildRequest(BaseModel):
    datasource_id: str | None = None
    # Optional subset/override of questions to build from (defaults to all KPIs).
    questions: list[str] | None = None


class RequirementPromoteRequest(BaseModel):
    # No upper bound here on purpose: the authoritative check is against the
    # document's actual KPI count in the service, so a constant mirroring
    # ai.requirements._MAX_KPIS would only add a second number to keep in sync.
    kpi_index: int = Field(ge=0)
    # REQUIRED. `_compute_impact_status` can only reach "achieved" through
    # `predicted_value is not None` (decision_service.py:117,124), so a KPI
    # promoted without a number carries no testable criterion at all.
    # allow_inf_nan closes the JSON `1e400` → inf path, which would make
    # `realized >= predicted` permanently False rather than merely wrong.
    target_value: float = Field(allow_inf_nan=False)
    direction: Direction | None = None
    datasource_id: str | None = None


class RequirementResponse(BaseModel):
    id: str
    name: str
    kpis: list[KpiItem] = Field(default_factory=list)
    dashboard_id: str | None = None
    created_at: datetime


class RequirementPromoteResponse(BaseModel):
    decision: DecisionResponse
    # The whole document comes back so the client never has to synthesise the
    # link it just caused (mirrors BAPromoteResponse).
    requirement: RequirementResponse
