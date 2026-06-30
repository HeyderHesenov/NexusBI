"""Insight engine endpoints — auto-discovery feed."""
from __future__ import annotations

from fastapi import APIRouter, Response, status

from app.dependencies import CurrentUser, DbDep
from app.schemas.insight import InsightResponse
from app.services import insight_engine as svc

router = APIRouter(prefix="/insights", tags=["insights"])


@router.get("/", response_model=list[InsightResponse])
async def list_insights(user: CurrentUser, db: DbDep) -> list[InsightResponse]:
    return [InsightResponse.model_validate(i) for i in await svc.list_for(db, user.id)]


@router.post("/generate")
async def generate(user: CurrentUser, db: DbDep) -> dict[str, int]:
    """Scan recent results and persist newly-discovered insights. Pure stats — no AI quota."""
    created = await svc.scan(db, user.id)
    return {"created": len(created)}


@router.post("/{insight_id}/dismiss", status_code=status.HTTP_204_NO_CONTENT)
async def dismiss(insight_id: str, user: CurrentUser, db: DbDep) -> Response:
    await svc.dismiss(db, user.id, insight_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
