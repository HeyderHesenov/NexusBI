"""Public (unauthenticated) read-only endpoints for shared dashboards."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select

from app.billing.tiers import has_white_label
from app.core.exceptions import NexusBIException
from app.core.rate_limit import rate_limit
from app.dependencies import CacheDep, DbDep
from app.models.dashboard import Dashboard
from app.models.user import User
from app.schemas.comment import CommentResponse
from app.schemas.dashboard import DashboardFilterResponse, DashboardFilterSpec, DashboardResponse
from app.schemas.embed import BrandConfigResponse, EmbeddedDashboard
from app.services import brand_service, comment_service, embed_service
from app.services import dashboard_service as svc
from app.services.cache_service import CacheService
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter(prefix="/public", tags=["public"])

# Share tokens are bearer secrets — throttle per IP to blunt token brute-forcing.
_share_limit = Depends(rate_limit("public_share", limit=30, window_seconds=60))
# Filtering re-executes SQL per widget — much stricter than plain reads.
_filter_limit = Depends(rate_limit("public_filter", limit=10, window_seconds=60))

# Anonymous compute surface: tighter caps than the owner endpoint.
_MAX_PUBLIC_DIMENSIONS = 5
_MAX_PUBLIC_VALUES = 60


async def _shared_filter(
    db: AsyncSession, cache: CacheService, dash: Dashboard, payload: DashboardFilterSpec
) -> DashboardFilterResponse:
    """Apply a viewer-supplied filter to a shared/embedded dashboard.

    NOT persisted — the owner's PATCH endpoint stays the only writer of
    ``global_filter``. Runs with ``skip_rls=True`` (the live-broadcast
    precedent): widgets on an RLS-restricted source come back ``chart=None``
    so an owner-scoped row set never reaches an anonymous viewer.

    Every filter column must exist in the dashboard's STORED widget result
    columns; otherwise an anonymous token holder could slice by hidden
    columns (e.g. ``salary``) and bisect values the dashboard never shows.
    Enforcement is belt-and-suspenders: this fast 400 rejects columns absent
    from the *whole* dashboard, and ``restrict_to_widget_columns=True`` makes
    ``apply_global_filter`` bind each dimension only to widgets that actually
    display it — so a name shown by one widget can't slice a *different*
    widget's same-named but hidden base-table column.
    """
    # Cap on the MERGED view: several dimensions carrying the same column are
    # coalesced into one IN-list by dashboard_filter_sql._normalize, so a naive
    # per-dimension check lets 5×60 values slip through as one 300-value predicate.
    merged: dict[str, set[str]] = {}
    for d in payload.dimensions:
        merged.setdefault(d.column, set()).update(str(v) for v in d.values)
    if len(merged) > _MAX_PUBLIC_DIMENSIONS:
        raise NexusBIException("Çox sayda filtr ölçüsü.")
    if any(len(vals) > _MAX_PUBLIC_VALUES for vals in merged.values()):
        raise NexusBIException("Filtr dəyərlərinin sayı limiti aşır.")

    widgets = list(dash.widgets)
    logs = await svc.load_widget_query_logs(db, widgets, dash.user_id)
    allowed = {
        str(col).lower()
        for log in logs.values()
        for col in (log.result_data or {}).get("columns", [])
    }
    requested = list(merged)
    if payload.date_column:
        requested.append(payload.date_column)
    for col in requested:
        if col.lower() not in allowed:
            raise NexusBIException("Filtr sütunu bu paneldə mövcud deyil.")

    spec = payload.model_dump()
    filtered = await svc.apply_global_filter(
        db, dash.user_id, dash.id, spec, cache, skip_rls=True,
        restrict_to_widget_columns=True,
    )
    return DashboardFilterResponse(global_filter=spec, widgets=filtered)


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


@router.post(
    "/dashboard/{token}/filter",
    response_model=DashboardFilterResponse,
    dependencies=[_filter_limit],
)
async def shared_dashboard_filter(
    token: str, payload: DashboardFilterSpec, db: DbDep, cache: CacheDep
) -> DashboardFilterResponse:
    """Viewer-side filtering of a shared dashboard (read-only, not persisted)."""
    dash = await svc.get_by_token(db, token)
    return await _shared_filter(db, cache, dash, payload)


@router.post(
    "/embed/{token}/filter",
    response_model=DashboardFilterResponse,
    dependencies=[_filter_limit],
)
async def embedded_dashboard_filter(
    token: str, payload: DashboardFilterSpec, db: DbDep, cache: CacheDep
) -> DashboardFilterResponse:
    """Viewer-side filtering of an embedded dashboard (read-only, not persisted)."""
    dash = await embed_service.resolve(db, token)
    return await _shared_filter(db, cache, dash, payload)


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
