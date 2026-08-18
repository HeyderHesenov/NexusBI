"""Requirements → dashboard endpoints (BRD/user-story → KPIs → panel)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, status

from app.core.rate_limit import rate_limit
from app.dependencies import CacheDep, CurrentUser, DbDep, RateLimitedUser
from app.schemas.dashboard import DashboardResponse
from app.schemas.decision import DecisionResponse
from app.schemas.requirement import (
    RequirementBuildRequest,
    RequirementExtractRequest,
    RequirementPromoteRequest,
    RequirementPromoteResponse,
    RequirementResponse,
)
from app.services import dashboard_service
from app.services import requirement_service as svc

router = APIRouter(prefix="/requirements", tags=["requirements"])

# Promoting captures a Decision baseline, which can run a metric query — the same
# reason /ba/{id}/promote carries a burst limit on top of the monthly AI counter.
_promote_limit = rate_limit("requirement_promote", limit=20, window_seconds=60)


@router.post("/extract", response_model=RequirementResponse, status_code=status.HTTP_201_CREATED)
async def extract(
    payload: RequirementExtractRequest, user: RateLimitedUser, db: DbDep
) -> RequirementResponse:
    """Extract measurable KPIs from a requirements document (AI + fallback)."""
    doc = await svc.extract_and_save(db, user.id, payload.name, payload.text)
    return svc.to_response(doc)


@router.get("", response_model=list[RequirementResponse])
async def list_docs(user: CurrentUser, db: DbDep) -> list[RequirementResponse]:
    return await svc.list_response(db, user.id)


@router.get("/{doc_id}", response_model=RequirementResponse)
async def get_doc(doc_id: str, user: CurrentUser, db: DbDep) -> RequirementResponse:
    """One document with its KPIs' current outcomes.

    The client re-reads this after measuring rather than patching from the
    measure response: DecisionROI carries the values but no data_as_of, so
    patching locally would quietly drop the freshness signal on the one path
    where the number just changed.
    """
    return await svc.get_response(db, user.id, doc_id)


@router.post("/{doc_id}/build", response_model=DashboardResponse, status_code=status.HTTP_201_CREATED)
async def build(
    doc_id: str,
    payload: RequirementBuildRequest,
    user: RateLimitedUser,
    db: DbDep,
    cache: CacheDep,
) -> DashboardResponse:
    """Build a dashboard from the document's KPIs (fans out into several queries)."""
    dash = await svc.build(db, cache, user.id, doc_id, payload.datasource_id, payload.questions)
    return await dashboard_service.to_response(db, user.id, dash)


@router.post(
    "/{doc_id}/promote",
    response_model=RequirementPromoteResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(_promote_limit)],
)
async def promote_kpi(
    doc_id: str,
    payload: RequirementPromoteRequest,
    user: RateLimitedUser,
    db: DbDep,
    cache: CacheDep,
) -> RequirementPromoteResponse:
    """Bind one extracted KPI to a tracked Decision (idempotent per KPI).

    Uses the AI quota: the KPI's question becomes the decision's metric query, so
    capturing the baseline runs a full NL→SQL pass rather than reusing a log.
    """
    decision, doc = await svc.promote_kpi(db, cache, user.id, doc_id, payload)
    return RequirementPromoteResponse(
        decision=DecisionResponse.model_validate(decision),
        # WITH the outcomes joined. Without them every KPI returns outcome=null,
        # the client swaps that document in, and the row falls back to the "enter
        # a target" form — so the verdict this endpoint just produced would not
        # appear until a full page reload.
        requirement=await svc.response_for(db, user.id, doc),
    )
