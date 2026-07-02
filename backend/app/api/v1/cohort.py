"""Cohort retention and funnel analytics endpoints (deterministic, no AI)."""
from __future__ import annotations

from fastapi import APIRouter

from app.dependencies import CurrentUser
from app.schemas.cohort import CohortResponse, FunnelResponse
from app.services import cohort_service

router = APIRouter(prefix="/cohort", tags=["cohort"])


@router.get("/retention", response_model=CohortResponse)
async def retention(user: CurrentUser) -> CohortResponse:
    return CohortResponse.model_validate(cohort_service.retention())


@router.get("/funnel", response_model=FunnelResponse)
async def funnel(user: CurrentUser) -> FunnelResponse:
    return FunnelResponse.model_validate(cohort_service.funnel())
