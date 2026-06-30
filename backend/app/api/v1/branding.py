"""White-label brand config endpoints."""
from __future__ import annotations

from fastapi import APIRouter

from app.billing.tiers import has_white_label
from app.core.exceptions import ForbiddenError
from app.dependencies import CurrentUser, DbDep
from app.schemas.embed import BrandConfigResponse, BrandConfigUpdate
from app.services import brand_service

router = APIRouter(prefix="/brand", tags=["branding"])


@router.get("", response_model=BrandConfigResponse)
async def get_brand(user: CurrentUser, db: DbDep) -> BrandConfigResponse:
    cfg = await brand_service.get(db, user.id)
    return BrandConfigResponse(**brand_service.as_dict(cfg))


@router.put("", response_model=BrandConfigResponse)
async def update_brand(
    payload: BrandConfigUpdate, user: CurrentUser, db: DbDep
) -> BrandConfigResponse:
    # White-label is a paid capability — free tier cannot set custom branding.
    if not has_white_label(user.subscription_tier):
        raise ForbiddenError(
            "White-label brending Pro və üstü planlarda mövcuddur.",
            detail="white_label_requires_plan",
        )
    cfg = await brand_service.upsert(db, user.id, payload)
    return BrandConfigResponse(**brand_service.as_dict(cfg))
