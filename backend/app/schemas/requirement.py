"""Requirements → dashboard schemas."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class KpiItem(BaseModel):
    name: str = ""
    question: str = ""
    rationale: str = ""
    requirement_ref: str = ""


class RequirementExtractRequest(BaseModel):
    name: str = Field(default="", max_length=255)
    text: str = Field(min_length=1, max_length=20000)


class RequirementBuildRequest(BaseModel):
    datasource_id: str | None = None
    # Optional subset/override of questions to build from (defaults to all KPIs).
    questions: list[str] | None = None


class RequirementResponse(BaseModel):
    id: str
    name: str
    kpis: list[KpiItem] = Field(default_factory=list)
    dashboard_id: str | None = None
    created_at: datetime
