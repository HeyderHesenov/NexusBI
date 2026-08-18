"""Turn a verified Stripe event into an entitlement change.

Only three events matter, and each is an ASSIGNMENT, so a replayed delivery
lands on the same state. The hazard worth guarding is ordering rather than
replay: a cancellation for a subscription the user has already replaced must not
downgrade the one they are paying for.

Nothing here verifies anything — the caller must have checked the signature
first. Keeping that split means the entitlement rules can be read without the
crypto, and the crypto can be tested without a database.
"""
from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.billing.tiers import DEFAULT_TIER, PURCHASABLE
from app.core.logging import get_logger
from app.core.notification_types import NotificationCategory
from app.models.user import User
from app.services import notify_service

_log = get_logger("nexusbi.billing")

# Everything else is acknowledged and dropped: a non-2xx makes Stripe retry for
# days over an event we never asked for.
HANDLED = ("checkout.session.completed", "customer.subscription.deleted", "invoice.payment_failed")


async def _by_customer(db: AsyncSession, customer_id: str | None) -> User | None:
    if not customer_id:
        return None
    return await db.scalar(select(User).where(User.stripe_customer_id == customer_id))


async def _granted(db: AsyncSession, obj: dict[str, Any]) -> str:
    """checkout.session.completed — the only place a paid tier is granted."""
    # This event also fires for delayed-notification methods (SEPA, Bacs, Boleto,
    # several bank redirects) with the money not yet taken; the arrival signal
    # there is `async_payment_succeeded`. Since payment methods are switched on in
    # Stripe's dashboard rather than in this code, without this check enabling one
    # there would quietly turn checkout into "start it, get the tier, never pay".
    if str(obj.get("payment_status") or "") not in ("paid", "no_payment_required"):
        _log.info("stripe_session_not_paid", status=str(obj.get("payment_status"))[:32])
        return "not_paid"

    subscription_id = str(obj.get("subscription") or "")
    if not subscription_id:
        # A grant that cannot be reversed is worse than no grant: `_cancelled`
        # matches on the subscription id, so a session without one (mode=payment,
        # a dashboard Payment Link, a trimmed replay) would leave the user on a
        # paid tier no webhook could ever take back.
        _log.warning("stripe_session_without_subscription")
        return "no_subscription"

    tier = str((obj.get("metadata") or {}).get("tier") or "")
    if tier not in PURCHASABLE:
        # The same rule /billing/upgrade enforces: `metadata` is client-shaped
        # data that reached Stripe from a browser, so it can no more grant the
        # internal unlimited tier here than it could there.
        _log.warning("stripe_unpurchasable_tier", tier=tier[:32])
        return "ignored_tier"

    user = None
    if reference := obj.get("client_reference_id"):
        user = await db.get(User, str(reference))
    user = user or await _by_customer(db, obj.get("customer"))
    if user is None:
        # Acknowledged, not retried: a payment for a user this deployment does
        # not have (a deleted account, another environment sharing the endpoint)
        # will never resolve by trying again.
        _log.warning("stripe_unknown_user", customer=str(obj.get("customer"))[:32])
        return "unknown_user"

    user.stripe_customer_id = str(obj.get("customer") or "") or user.stripe_customer_id
    user.stripe_subscription_id = subscription_id
    user.subscription_tier = tier
    await db.flush()
    _log.info("stripe_tier_granted", user_id=user.id, tier=tier)
    return "granted"


async def _cancelled(db: AsyncSession, obj: dict[str, Any]) -> str:
    """customer.subscription.deleted — the end of Stripe's dunning, or a cancel."""
    subscription_id = str(obj.get("id") or "")
    if not subscription_id:
        return "ignored_shape"
    # Matched on the SUBSCRIPTION, never on the customer: a user who cancelled
    # and re-subscribed has both in Stripe's history, and the old one's event can
    # arrive after the new checkout completed.
    user = await db.scalar(
        select(User).where(User.stripe_subscription_id == subscription_id)
    )
    if user is None:
        return "stale_or_unknown"

    user.subscription_tier = DEFAULT_TIER
    user.stripe_subscription_id = None  # the customer id stays: they may return
    await db.flush()
    _log.info("stripe_tier_revoked", user_id=user.id)
    return "revoked"


async def _payment_failed(db: AsyncSession, obj: dict[str, Any]) -> str:
    """invoice.payment_failed — a message, not a punishment.

    Stripe retries the invoice for days and cancels only at the end of that
    process, which arrives as the event above. Dropping the tier on the first
    failure would punish a card that had a bad afternoon, and would then need
    `invoice.payment_succeeded` handling to undo itself.
    """
    user = await _by_customer(db, obj.get("customer"))
    if user is None:
        return "unknown_customer"
    await notify_service.create(
        db,
        user.id,
        "Ödəniş alınmadı",
        "Abunə ödənişin uğursuz oldu. Kartı yeniləməsən, abunə bir neçə gün sonra dayandırıla bilər.",
        NotificationCategory.BILLING,
    )
    _log.info("stripe_payment_failed_notified", user_id=user.id)
    return "notified"


async def apply(db: AsyncSession, event: dict[str, Any]) -> str:
    """Apply one verified event. Returns a short outcome label for the log."""
    event_type = str(event.get("type") or "")
    obj = (event.get("data") or {}).get("object") or {}
    if not isinstance(obj, dict):
        return "ignored_shape"

    if event_type == "checkout.session.completed":
        return await _granted(db, obj)
    if event_type == "customer.subscription.deleted":
        return await _cancelled(db, obj)
    if event_type == "invoice.payment_failed":
        return await _payment_failed(db, obj)
    if event_type == "customer.subscription.updated":
        # Deliberately not handled, and logged rather than dropped silently: a
        # plan switch inside the Billing Portal would arrive HERE and nowhere
        # else. It cannot happen with the current configuration — checkout builds
        # inline `price_data`, and the portal can only switch between prices
        # configured as products — so the portal must keep plan switching off.
        # If that ever changes, this log is the first place it shows up.
        _log.info("stripe_subscription_updated_unhandled", id=str(obj.get("id"))[:64])
        return "ignored_update"
    return "ignored_type"
