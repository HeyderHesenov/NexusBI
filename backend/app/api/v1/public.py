"""Public (unauthenticated) read-only endpoints for shared dashboards."""
from __future__ import annotations

from fastapi import APIRouter

from app.dependencies import DbDep
from app.schemas.dashboard import DashboardResponse
from app.services import dashboard_service as svc

router = APIRouter(prefix="/public", tags=["public"])


@router.get("/dashboard/{token}", response_model=DashboardResponse)
async def shared_dashboard(token: str, db: DbDep) -> DashboardResponse:
    """Serve a shared dashboard's read-only snapshot. No auth — token is the secret."""
    dash = await svc.get_by_token(db, token)
    return DashboardResponse(
        id=dash.id,
        name=dash.name,
        description=dash.description,
        layout=dash.layout,
        widgets=await svc.widgets_to_response(db, list(dash.widgets), dash.user_id),
    )
