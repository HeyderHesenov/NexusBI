"""Billing endpoints — plan catalogue, usage, and (mock) upgrade.

The upgrade path is intentionally a mock: it flips the user's tier without a
payment provider. It is structured so a Stripe Checkout session can slot in here
later without touching callers.
"""
from __future__ import annotations

import json

from fastapi import APIRouter, Depends, Request, Response

from app.billing import stripe_events, usage_service
from app.billing.stripe_signature import SignatureError, verify
from app.billing.tiers import PURCHASABLE, TIERS, get_tier
from app.config import settings
from app.core.exceptions import NexusBIException
from app.core.logging import get_logger
from app.core.rate_limit import rate_limit
from app.dependencies import CurrentUser, DbDep
from app.schemas.billing import PlanInfo, UpgradeRequest, UsageResponse

_log = get_logger("nexusbi.billing")

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
    return UsageResponse(
        **usage_service.get_usage(user),
        # Two flags rather than a second round trip: the pricing page already
        # loads usage, and it has to choose between the real checkout, the demo
        # mock, and the manage-subscription button before it can render.
        payments_enabled=bool(settings.STRIPE_SECRET_KEY),
        has_subscription=bool(user.stripe_customer_id),
    )


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


@router.post("/webhook", include_in_schema=False)
async def webhook(request: Request, db: DbDep) -> Response:
    """Stripe's callback. Unauthenticated by necessity — the signature IS the auth.

    Status codes are operational instructions to Stripe, not decoration:
      * 503 — we are misconfigured; Stripe should keep retrying while we fix it.
      * 400 — the request did not prove it came from Stripe, or is not an event.
        Retrying will not change either, and a 2xx here would mean accepting
        unsigned instructions to grant paid plans.
      * 200 — handled, or deliberately ignored. Anything else makes Stripe retry
        for days over an event we never wanted.
    """
    if not settings.STRIPE_WEBHOOK_SECRET:
        # 503, not 400: Stripe keeps retrying a 5xx for days, so events that
        # arrive while the secret is missing are still delivered once it is set.
        _log.error("stripe_webhook_unconfigured")
        return Response(status_code=503)

    raw = await request.body()  # bytes as received: the digest covers these, not re-serialized JSON
    try:
        verify(raw, request.headers.get("Stripe-Signature", ""), settings.STRIPE_WEBHOOK_SECRET)
    except SignatureError as exc:
        _log.warning("stripe_signature_rejected", reason=str(exc)[:120])
        raise NexusBIException("Stripe imzası qəbul edilmədi.", detail="bad_signature") from exc

    try:
        event = json.loads(raw)
    except ValueError as exc:
        raise NexusBIException("Stripe hadisəsi oxunmadı.", detail="bad_payload") from exc
    if not isinstance(event, dict):
        raise NexusBIException("Stripe hadisəsi oxunmadı.", detail="bad_payload")

    outcome = await stripe_events.apply(db, event)
    _log.info("stripe_event", type=str(event.get("type"))[:64], outcome=outcome)
    return Response(status_code=200)


@router.post(
    "/portal",
    # Each hit calls Stripe. Ten a minute is far past any honest use of a
    # button that navigates away from the page.
    dependencies=[Depends(rate_limit("billing_portal", limit=10, window_seconds=60))],
)
async def portal(user: CurrentUser) -> dict[str, str]:
    """A hosted page where the customer can cancel or fix their card.

    Without it the cancellation half of the loop has no trigger a user can reach,
    and the "payment failed" notification points nowhere.
    """
    if not settings.STRIPE_SECRET_KEY:
        raise NexusBIException("Stripe konfiqurasiya olunmayıb.", detail="stripe_not_configured")
    if not user.stripe_customer_id:
        raise NexusBIException("Aktiv abunə yoxdur.", detail="no_subscription")
    try:
        import stripe  # optional dependency — only needed for live billing
    except ImportError as exc:
        raise NexusBIException("Stripe SDK quraşdırılmayıb.", detail="stripe_missing") from exc

    stripe.api_key = settings.STRIPE_SECRET_KEY
    session = stripe.billing_portal.Session.create(
        customer=user.stripe_customer_id,
        return_url=settings.STRIPE_PORTAL_RETURN_URL,
    )
    return {"portal_url": session.url}
