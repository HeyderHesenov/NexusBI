"""Requirements → dashboard endpoints (BRD/user-story → KPIs → panel)."""
from __future__ import annotations

from fastapi import APIRouter, status

from app.dependencies import CacheDep, CurrentUser, DbDep, RateLimitedUser
from app.schemas.dashboard import DashboardResponse
from app.schemas.requirement import (
    RequirementBuildRequest,
    RequirementExtractRequest,
    RequirementResponse,
)
from app.services import dashboard_service
from app.services import requirement_service as svc

router = APIRouter(prefix="/requirements", tags=["requirements"])


@router.post("/extract", response_model=RequirementResponse, status_code=status.HTTP_201_CREATED)
async def extract(
    payload: RequirementExtractRequest, user: RateLimitedUser, db: DbDep
) -> RequirementResponse:
    """Extract measurable KPIs from a requirements document (AI + fallback)."""
    doc = await svc.extract_and_save(db, user.id, payload.name, payload.text)
    return svc.to_response(doc)


@router.get("", response_model=list[RequirementResponse])
async def list_docs(user: CurrentUser, db: DbDep) -> list[RequirementResponse]:
    return [svc.to_response(d) for d in await svc.list_for_user(db, user.id)]


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
