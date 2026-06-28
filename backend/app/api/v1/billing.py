"""Billing endpoints — plan catalogue, usage, and (mock) upgrade.

The upgrade path is intentionally a mock: it flips the user's tier without a
payment provider. It is structured so a Stripe Checkout session can slot in here
later without touching callers.
"""
from __future__ import annotations

from fastapi import APIRouter

from app.billing import usage_service
from app.billing.tiers import PURCHASABLE, TIERS, get_tier
from app.config import settings
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
        for t in (TIERS[k] for k in PURCHASABLE)
    ]


@router.get("/usage", response_model=UsageResponse)
async def usage(user: CurrentUser) -> UsageResponse:
    return UsageResponse(**usage_service.get_usage(user))


@router.post("/upgrade", response_model=UsageResponse)
async def upgrade(payload: UpgradeRequest, user: CurrentUser, db: DbDep) -> UsageResponse:
    # Only publicly-purchasable plans — never the internal "unlimited" tier, so a
    # user can't self-escalate to an unlimited quota.
    if payload.tier not in PURCHASABLE:
        raise NexusBIException("Naməlum və ya əlçatmaz plan.")
    # The tier flip is a mock checkout. Outside demo it MUST be gated behind a real
    # payment provider, so refuse rather than grant a paid plan for free.
    if not settings.DEMO_MODE:
        raise NexusBIException("Plan yüksəltmək üçün ödəniş tələb olunur.", detail="payment_required")
    user.subscription_tier = get_tier(payload.tier).key
    await db.flush()
    return UsageResponse(**usage_service.get_usage(user))


@router.post("/checkout")
async def checkout(payload: UpgradeRequest, user: CurrentUser) -> dict[str, str]:
    """Start a real Stripe Checkout (config-gated).

    Returns a checkout_url when STRIPE_SECRET_KEY is set and the `stripe` SDK is
    installed; otherwise refuses (the mock /upgrade path is used in demo).
    """
    if payload.tier not in PURCHASABLE:
        raise NexusBIException("Naməlum və ya əlçatmaz plan.")
    if not settings.STRIPE_SECRET_KEY:
        raise NexusBIException("Stripe konfiqurasiya olunmayıb.", detail="stripe_not_configured")
    try:
        import stripe  # optional dependency — only needed for live billing
    except ImportError as exc:
        raise NexusBIException("Stripe SDK quraşdırılmayıb.", detail="stripe_missing") from exc

    tier = get_tier(payload.tier)
    stripe.api_key = settings.STRIPE_SECRET_KEY
    session = stripe.checkout.Session.create(
        mode="subscription",
        success_url=settings.STRIPE_SUCCESS_URL,
        cancel_url=settings.STRIPE_CANCEL_URL,
        client_reference_id=user.id,
        line_items=[
            {
                "price_data": {
                    "currency": "usd",
                    "unit_amount": int(tier.price_usd * 100),
                    "recurring": {"interval": "month"},
                    "product_data": {"name": f"NexusBI {tier.name}"},
                },
                "quantity": 1,
            }
        ],
        metadata={"tier": tier.key},
    )
    return {"checkout_url": session.url}
