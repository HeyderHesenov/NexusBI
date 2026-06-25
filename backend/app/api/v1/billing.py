"""Billing endpoints — plan catalogue, usage, and (mock) upgrade.

The upgrade path is intentionally a mock: it flips the user's tier without a
payment provider. It is structured so a Stripe Checkout session can slot in here
later without touching callers.
"""
from __future__ import annotations

from fastapi import APIRouter

from app.billing import usage_service
from app.billing.tiers import TIERS, get_tier
from app.core.exceptions import NexusBIException
from app.dependencies import CurrentUser, DbDep
from app.schemas.billing import PlanInfo, UpgradeRequest, UsageResponse

router = APIRouter(prefix="/billing", tags=["billing"])


@router.get("/plans", response_model=list[PlanInfo])
async def plans() -> list[PlanInfo]:
    return [
        PlanInfo(
            key=t.key,
            name=t.name,
            price_usd=t.price_usd,
            monthly_quota=t.monthly_quota,
            features=t.features,
        )
        for t in TIERS.values()
    ]


@router.get("/usage", response_model=UsageResponse)
async def usage(user: CurrentUser) -> UsageResponse:
    return UsageResponse(**usage_service.get_usage(user))


@router.post("/upgrade", response_model=UsageResponse)
async def upgrade(payload: UpgradeRequest, user: CurrentUser, db: DbDep) -> UsageResponse:
    if payload.tier not in TIERS:
        raise NexusBIException("Naməlum plan.")
    # Mock checkout: flip the tier. (Stripe Checkout session would go here.)
    user.subscription_tier = get_tier(payload.tier).key
    await db.flush()
    return UsageResponse(**usage_service.get_usage(user))
