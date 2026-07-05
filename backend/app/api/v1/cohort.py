"""Cohort retention and funnel analytics endpoints (deterministic, no AI).

Accept an optional column mapping: with a datasource + table + columns the
analysis runs on the user's real data (through the /query guard chain); an
empty body falls back to the demo snapshot.
"""
from __future__ import annotations

from fastapi import APIRouter

from app.dependencies import CacheDep, CurrentUser, DbDep
from app.schemas.cohort import CohortQuery, CohortResponse, FunnelResponse
from app.services import cohort_service

router = APIRouter(prefix="/cohort", tags=["cohort"])


@router.post("/retention", response_model=CohortResponse)
async def retention(
    user: CurrentUser, db: DbDep, cache: CacheDep, body: CohortQuery | None = None
) -> CohortResponse:
    q = body or CohortQuery()
    data = await cohort_service.retention(
        db, cache, user.id, q.datasource_id, q.table, q.entity_col, q.date_col
    )
    return CohortResponse.model_validate(data)


@router.post("/funnel", response_model=FunnelResponse)
async def funnel(
    user: CurrentUser, db: DbDep, cache: CacheDep, body: CohortQuery | None = None
) -> FunnelResponse:
    q = body or CohortQuery()
    data = await cohort_service.funnel(
        db, cache, user.id, q.datasource_id, q.table, q.entity_col, q.stage_col
    )
    return FunnelResponse.model_validate(data)
