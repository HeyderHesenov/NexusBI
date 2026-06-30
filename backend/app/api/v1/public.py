"""Public (unauthenticated) read-only endpoints for shared dashboards."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select

from app.billing.tiers import has_white_label
from app.core.rate_limit import rate_limit
from app.dependencies import DbDep
from app.models.user import User
from app.schemas.comment import CommentResponse
from app.schemas.dashboard import DashboardResponse
from app.schemas.embed import BrandConfigResponse, EmbeddedDashboard
from app.services import brand_service, comment_service, embed_service
from app.services import dashboard_service as svc

router = APIRouter(prefix="/public", tags=["public"])

# Share tokens are bearer secrets — throttle per IP to blunt token brute-forcing.
_share_limit = Depends(rate_limit("public_share", limit=30, window_seconds=60))


@router.get("/dashboard/{token}", response_model=DashboardResponse, dependencies=[_share_limit])
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


@router.get("/embed/{token}", response_model=EmbeddedDashboard, dependencies=[_share_limit])
async def embedded_dashboard(token: str, db: DbDep) -> EmbeddedDashboard:
    """Serve a read-only embedded dashboard + the owner's white-label brand."""
    dash = await embed_service.resolve(db, token)  # validates token + embed_enabled
    # White-label only renders for owners on a tier that includes it; otherwise the
    # embed falls back to default NexusBI branding (so a downgrade silently reverts,
    # and a stored config from a former paid period is never leaked).
    owner_tier = await db.scalar(select(User.subscription_tier).where(User.id == dash.user_id))
    brand = await brand_service.get(db, dash.user_id) if has_white_label(owner_tier) else None
    return EmbeddedDashboard(
        dashboard=DashboardResponse(
            id=dash.id,
            name=dash.name,
            description=dash.description,
            layout=dash.layout,
            widgets=await svc.widgets_to_response(db, list(dash.widgets), dash.user_id),
        ),
        brand=BrandConfigResponse(**brand_service.as_dict(brand)),
    )


@router.get(
    "/dashboard/{token}/comments",
    response_model=list[CommentResponse],
    dependencies=[_share_limit],
)
async def shared_comments(token: str, db: DbDep) -> list[CommentResponse]:
    """Comment history for a shared dashboard (guest access via the share token)."""
    dash = await svc.get_by_token(db, token)
    items = await comment_service.list_for_dashboard(db, dash.id)
    return [CommentResponse.model_validate(c) for c in items]
