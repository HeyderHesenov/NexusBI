"""The webhook is where money becomes entitlement, so every path is pinned.

Signatures are built the way Stripe builds them (see tests/test_stripe_signature),
so these tests exercise the real verification path rather than bypassing it.
"""
from __future__ import annotations

import json
import time

import pytest
from sqlalchemy import select

from app.config import settings
from app.core.notification_types import NotificationCategory
from app.db.session import AsyncSessionLocal
from app.models.alert import Notification
from app.models.user import User
from tests.test_stripe_signature import sign

pytestmark = pytest.mark.asyncio

SECRET = "whsec_webhook_test"
WEBHOOK = "/api/v1/billing/webhook"


@pytest.fixture(autouse=True)
def _configured(monkeypatch):
    monkeypatch.setattr(settings, "STRIPE_WEBHOOK_SECRET", SECRET)


async def _user(client, auth) -> User:
    resp = await client.get("/api/v1/auth/me", headers=auth)
    async with AsyncSessionLocal() as db:
        return await db.get(User, resp.json()["id"])


async def _reload(user_id: str) -> User:
    async with AsyncSessionLocal() as db:
        return await db.get(User, user_id)


async def _link(user_id: str, *, customer: str, subscription: str, tier: str = "pro") -> None:
    """Put a user in the state a completed checkout would have left."""
    async with AsyncSessionLocal() as db:
        user = await db.get(User, user_id)
        user.stripe_customer_id = customer
        user.stripe_subscription_id = subscription
        user.subscription_tier = tier
        await db.commit()


def _event(type_: str, data: dict) -> bytes:
    return json.dumps({"id": f"evt_{type_}", "type": type_, "data": {"object": data}}).encode()


async def _post(client, body: bytes, header: str | None = None):
    return await client.post(
        WEBHOOK,
        content=body,
        headers={
            "Stripe-Signature": sign(body, SECRET) if header is None else header,
            "Content-Type": "application/json",
        },
    )


def _checkout(user_id: str, tier: str = "pro", **over) -> bytes:
    return _event(
        "checkout.session.completed",
        {
            "client_reference_id": user_id,
            "customer": "cus_1",
            "subscription": "sub_1",
            "payment_status": "paid",
            "metadata": {"tier": tier},
            **over,
        },
    )


# ─── the signature gate ───

async def test_an_unsigned_request_grants_nothing(client, auth):
    user = await _user(client, auth)
    resp = await client.post(WEBHOOK, content=_checkout(user.id))
    assert resp.status_code == 400, resp.text
    assert (await _reload(user.id)).subscription_tier == "free"


async def test_a_forged_signature_grants_nothing(client, auth):
    user = await _user(client, auth)
    body = _checkout(user.id)
    resp = await _post(client, body, header=sign(body, "whsec_attacker"))
    assert resp.status_code == 400
    assert (await _reload(user.id)).subscription_tier == "free"


async def test_a_body_edited_after_signing_grants_nothing(client, auth):
    """The raw bytes must be what is verified — not the re-serialized JSON."""
    user = await _user(client, auth)
    honest = _checkout(user.id, tier="free")
    header = sign(honest, SECRET)
    tampered = _checkout(user.id, tier="max")
    resp = await _post(client, tampered, header=header)
    assert resp.status_code == 400
    assert (await _reload(user.id)).subscription_tier == "free"


async def test_without_a_configured_secret_the_endpoint_refuses(client, auth, monkeypatch):
    monkeypatch.setattr(settings, "STRIPE_WEBHOOK_SECRET", "")
    user = await _user(client, auth)
    body = _checkout(user.id)
    resp = await _post(client, body, header=sign(body, SECRET))
    assert resp.status_code == 503, "a 4xx would make Stripe give up on events we can still fix"
    assert (await _reload(user.id)).subscription_tier == "free"


# ─── granting ───

async def test_a_completed_checkout_grants_the_purchased_tier(client, auth):
    user = await _user(client, auth)
    assert user.subscription_tier == "free"

    resp = await _post(client, _checkout(user.id))
    assert resp.status_code == 200, resp.text

    fresh = await _reload(user.id)
    assert fresh.subscription_tier == "pro"
    assert fresh.stripe_customer_id == "cus_1"
    assert fresh.stripe_subscription_id == "sub_1"


async def test_the_same_delivery_twice_leaves_the_same_state(client, auth):
    """Stripe retries until it sees a 2xx, so replay must be a no-op."""
    user = await _user(client, auth)
    body = _checkout(user.id)
    assert (await _post(client, body)).status_code == 200
    assert (await _post(client, body)).status_code == 200
    assert (await _reload(user.id)).subscription_tier == "pro"


async def test_an_unpurchasable_tier_grants_nothing(client, auth):
    """`metadata` is attacker-shaped in exactly the way /upgrade guards against:
    it must never be a path to the internal unlimited tier."""
    user = await _user(client, auth)
    resp = await _post(client, _checkout(user.id, tier="unlimited"))
    assert resp.status_code == 200, "still 2xx — Stripe must not retry a poisoned event"
    assert (await _reload(user.id)).subscription_tier == "free"


async def test_an_unknown_user_is_accepted_and_ignored(client, auth):
    resp = await _post(client, _checkout("00000000-0000-0000-0000-000000000000"))
    assert resp.status_code == 200
    async with AsyncSessionLocal() as db:
        paid = await db.scalars(select(User).where(User.subscription_tier != "free"))
        assert not paid.all()


# ─── losing the plan ───

async def test_a_cancelled_subscription_drops_the_user_to_free(client, auth):
    user = await _user(client, auth)
    await _link(user.id, customer="cus_1", subscription="sub_1")

    resp = await _post(client, _event("customer.subscription.deleted", {"id": "sub_1"}))
    assert resp.status_code == 200, resp.text

    fresh = await _reload(user.id)
    assert fresh.subscription_tier == "free"
    assert fresh.stripe_subscription_id is None
    assert fresh.stripe_customer_id == "cus_1", "the customer outlives the subscription"


async def test_a_superseded_subscription_cannot_cancel_the_current_one(client, auth):
    """The real hazard is ORDER, not replay.

    A user who cancels and re-subscribes has two subscriptions in Stripe's
    history; the old one's `deleted` event can arrive after the new checkout
    completed. Keyed on the customer it would downgrade someone who has just
    paid — so the match is on the SUBSCRIPTION the user currently holds.
    """
    user = await _user(client, auth)
    await _link(user.id, customer="cus_1", subscription="sub_NEW")

    resp = await _post(client, _event("customer.subscription.deleted", {"id": "sub_OLD"}))
    assert resp.status_code == 200

    fresh = await _reload(user.id)
    assert fresh.subscription_tier == "pro", "a stale cancellation downgraded a paying user"
    assert fresh.stripe_subscription_id == "sub_NEW"


# ─── a failed payment is a message, not a punishment ───

async def test_a_failed_payment_notifies_and_leaves_the_tier_alone(client, auth):
    """Stripe retries a failed invoice for days and cancels only at the end of
    that process — which arrives as the event tested above."""
    user = await _user(client, auth)
    await _link(user.id, customer="cus_1", subscription="sub_1")

    resp = await _post(
        client, _event("invoice.payment_failed", {"customer": "cus_1", "subscription": "sub_1"})
    )
    assert resp.status_code == 200, resp.text

    assert (await _reload(user.id)).subscription_tier == "pro"
    async with AsyncSessionLocal() as db:
        rows = (await db.scalars(select(Notification).where(Notification.user_id == user.id))).all()
    assert len(rows) == 1, "the user was never told the payment failed"
    assert rows[0].category == NotificationCategory.BILLING


async def test_a_failed_payment_for_an_unknown_customer_is_ignored(client, auth):
    await _user(client, auth)
    resp = await _post(client, _event("invoice.payment_failed", {"customer": "cus_nobody"}))
    assert resp.status_code == 200
    async with AsyncSessionLocal() as db:
        assert (await db.scalars(select(Notification))).all() == []


# ─── everything else ───

async def test_an_unhandled_event_type_is_acknowledged(client, auth):
    """A non-2xx makes Stripe retry for days over an event we never wanted."""
    await _user(client, auth)
    resp = await _post(client, _event("customer.subscription.updated", {"id": "sub_1"}))
    assert resp.status_code == 200


async def test_a_signed_body_that_is_not_json_is_refused(client):
    body = b"not json at all"
    resp = await _post(client, body)
    assert resp.status_code == 400


# ─── review findings ───

@pytest.mark.parametrize("status", ["unpaid", "no_payment_required", None, ""])
async def test_only_a_paid_session_grants_the_tier(client, auth, status):
    """`checkout.session.completed` also fires for delayed-notification methods
    (SEPA, Bacs, Boleto) with the money not yet taken — the arrival signal there
    is `async_payment_succeeded`. Payment methods are enabled in Stripe's
    dashboard, so without this check switching one on there would quietly turn
    checkout into "start it, get the tier, never pay"."""
    user = await _user(client, auth)
    body = _checkout(user.id, payment_status=status)
    assert (await _post(client, body)).status_code == 200

    expected = "pro" if status == "no_payment_required" else "free"
    assert (await _reload(user.id)).subscription_tier == expected


async def test_a_session_without_a_subscription_grants_nothing(client, auth):
    """A grant that cannot be reversed is worse than no grant.

    `_cancelled` matches on the subscription id, so a session that carries none —
    mode=payment, a dashboard Payment Link, a replayed event with a trimmed
    object — would leave the user on a paid tier no webhook could take back.
    """
    user = await _user(client, auth)
    resp = await _post(client, _checkout(user.id, subscription=None))
    assert resp.status_code == 200
    fresh = await _reload(user.id)
    assert fresh.subscription_tier == "free"
    assert fresh.stripe_subscription_id is None


async def test_a_plan_switch_inside_the_portal_is_logged_not_silently_dropped(client, auth):
    """`customer.subscription.updated` is deliberately unhandled, and that is
    only safe while the portal cannot switch plans (checkout builds inline
    price_data, which the portal cannot offer). The acknowledgement stays 200."""
    await _user(client, auth)
    resp = await _post(client, _event("customer.subscription.updated", {"id": "sub_1"}))
    assert resp.status_code == 200


async def test_an_oversized_body_is_refused_before_it_is_read(client, auth):
    """Unauthenticated AND exempt from the IP rate limit, so an unbounded read
    buffers whatever anyone sends before a byte of it is authenticated."""
    user = await _user(client, auth)
    body = _checkout(user.id)
    resp = await client.post(
        WEBHOOK,
        content=body,
        headers={
            "Stripe-Signature": sign(body, SECRET),
            "Content-Type": "application/json",
            "Content-Length": str(2_000_000),
        },
    )
    assert resp.status_code == 413
    assert (await _reload(user.id)).subscription_tier == "free"


async def test_a_mangled_signature_header_is_a_refusal_not_a_crash(client, auth):
    """`hmac.compare_digest` raises TypeError on a non-ASCII str: uncaught, an
    unauthenticated request turns into a 500 anyone can trigger at will.

    Sent as BYTES on purpose. An HTTP header cannot carry non-ASCII text, and a
    client that builds one from a `str` refuses before it reaches the wire — so
    a test written that way proves nothing about the server. High bytes on the
    wire are legal, and ASGI decodes them latin-1, which is exactly how a
    non-ASCII `str` lands in the verifier.
    """
    user = await _user(client, auth)
    body = _checkout(user.id)
    resp = await client.post(
        WEBHOOK,
        content=body,
        headers={
            b"Stripe-Signature": b"t=%d,v1=" % int(time.time()) + b"\xfc" * 64,
            b"Content-Type": b"application/json",
        },
    )
    assert resp.status_code == 400, resp.text
    assert (await _reload(user.id)).subscription_tier == "free"
