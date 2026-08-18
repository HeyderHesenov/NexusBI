"""The self-serve half: cancelling, and fixing a card after a failed payment.

Without this endpoint the downgrade path built in test_stripe_webhook has no
trigger a customer can reach — only the owner, by hand, in Stripe's dashboard.
"""
from __future__ import annotations

import sys
import types

import pytest

from app.config import settings
from app.db.session import AsyncSessionLocal
from app.models.user import User

pytestmark = pytest.mark.asyncio

PORTAL = "/api/v1/billing/portal"


async def _me(client, auth) -> str:
    return (await client.get("/api/v1/auth/me", headers=auth)).json()["id"]


def _fake_checkout(monkeypatch, recorder: dict):
    """Same stand-in, for the checkout half of the SDK."""
    module = types.ModuleType("stripe")

    class _Session:
        @staticmethod
        def create(**kwargs):
            recorder.update(kwargs)
            return types.SimpleNamespace(url="https://checkout.stripe.test/c/pay_1")

    module.api_key = None
    module.checkout = types.SimpleNamespace(Session=_Session)
    monkeypatch.setitem(sys.modules, "stripe", module)
    return module


def _fake_stripe(monkeypatch, recorder: dict):
    """A stand-in for the optional SDK, so the CALL SHAPE is pinned offline."""
    module = types.ModuleType("stripe")

    class _Session:
        @staticmethod
        def create(**kwargs):
            recorder.update(kwargs)
            recorder["api_key"] = module.api_key
            return types.SimpleNamespace(url="https://billing.stripe.test/session")

    module.api_key = None
    module.billing_portal = types.SimpleNamespace(Session=_Session)
    monkeypatch.setitem(sys.modules, "stripe", module)
    return module


async def test_a_subscriber_gets_a_portal_url(client, auth, monkeypatch):
    monkeypatch.setattr(settings, "STRIPE_SECRET_KEY", "sk_test_1")
    monkeypatch.setattr(settings, "STRIPE_PORTAL_RETURN_URL", "https://app.test/pricing")
    seen: dict = {}
    _fake_stripe(monkeypatch, seen)

    user_id = await _me(client, auth)
    async with AsyncSessionLocal() as db:
        user = await db.get(User, user_id)
        user.stripe_customer_id = "cus_42"
        await db.commit()

    resp = await client.post(PORTAL, headers=auth)
    assert resp.status_code == 200, resp.text
    assert resp.json()["portal_url"] == "https://billing.stripe.test/session"
    # The customer, not the user id: Stripe has never heard of our identifiers.
    assert seen["customer"] == "cus_42"
    assert seen["return_url"] == "https://app.test/pricing"
    assert seen["api_key"] == "sk_test_1"


async def test_a_user_who_never_paid_is_refused(client, auth, monkeypatch):
    monkeypatch.setattr(settings, "STRIPE_SECRET_KEY", "sk_test_1")
    _fake_stripe(monkeypatch, {})
    await _me(client, auth)
    resp = await client.post(PORTAL, headers=auth)
    assert resp.status_code == 400
    assert resp.json()["detail"] == "no_subscription"


async def test_without_stripe_configured_the_portal_refuses(client, auth, monkeypatch):
    monkeypatch.setattr(settings, "STRIPE_SECRET_KEY", "")
    user_id = await _me(client, auth)
    async with AsyncSessionLocal() as db:
        user = await db.get(User, user_id)
        user.stripe_customer_id = "cus_42"
        await db.commit()

    resp = await client.post(PORTAL, headers=auth)
    assert resp.status_code == 400
    assert resp.json()["detail"] == "stripe_not_configured"


async def test_the_portal_requires_a_login(client):
    assert (await client.post(PORTAL)).status_code in (401, 403)


async def test_usage_tells_the_client_which_upgrade_path_exists(client, auth, monkeypatch):
    """The pricing page has three possible buttons and no other way to choose."""
    monkeypatch.setattr(settings, "STRIPE_SECRET_KEY", "")
    monkeypatch.setattr(settings, "STRIPE_WEBHOOK_SECRET", "")
    body = (await client.get("/api/v1/billing/usage", headers=auth)).json()
    assert body["payments_enabled"] is False
    assert body["has_subscription"] is False
    assert body["has_billing_account"] is False

    monkeypatch.setattr(settings, "STRIPE_SECRET_KEY", "sk_test_1")
    monkeypatch.setattr(settings, "STRIPE_WEBHOOK_SECRET", "whsec_1")
    user_id = await _me(client, auth)
    async with AsyncSessionLocal() as db:
        user = await db.get(User, user_id)
        user.stripe_customer_id = "cus_42"
        user.stripe_subscription_id = "sub_42"
        await db.commit()

    body = (await client.get("/api/v1/billing/usage", headers=auth)).json()
    assert body["payments_enabled"] is True
    assert body["has_subscription"] is True
    assert body["has_billing_account"] is True


async def test_checkout_is_not_offered_while_the_webhook_cannot_grant(client, auth, monkeypatch):
    """The natural deploy order sets the API key first — the endpoint has to be
    reachable before Stripe can be told where to deliver. In that window a
    "payments enabled" page charges the card and the grant never arrives: every
    delivery hits 503 and Stripe gives up after about three days."""
    monkeypatch.setattr(settings, "STRIPE_SECRET_KEY", "sk_test_1")
    monkeypatch.setattr(settings, "STRIPE_WEBHOOK_SECRET", "")
    body = (await client.get("/api/v1/billing/usage", headers=auth)).json()
    assert body["payments_enabled"] is False, "a purchase that cannot complete was offered"


async def test_a_second_subscription_is_refused_rather_than_double_billed(client, auth, monkeypatch):
    """Stripe does not replace a subscription when a new session is completed —
    it bills both, and this app would only ever see the newest: the old one's
    cancellation no longer matches and its failed invoices find no user."""
    monkeypatch.setattr(settings, "STRIPE_SECRET_KEY", "sk_test_1")
    seen: dict = {}
    _fake_checkout(monkeypatch, seen)

    user_id = await _me(client, auth)
    async with AsyncSessionLocal() as db:
        user = await db.get(User, user_id)
        user.stripe_customer_id = "cus_42"
        user.stripe_subscription_id = "sub_42"
        await db.commit()

    resp = await client.post("/api/v1/billing/checkout", json={"tier": "max"}, headers=auth)
    assert resp.status_code == 400
    assert resp.json()["detail"] == "subscription_exists"
    assert not seen, "a second checkout session was created anyway"


async def test_a_returning_buyer_keeps_one_stripe_customer(client, auth, monkeypatch):
    """Without `customer=`, Stripe mints a fresh customer per checkout and the
    invoice history and portal split in two."""
    monkeypatch.setattr(settings, "STRIPE_SECRET_KEY", "sk_test_1")
    seen: dict = {}
    _fake_checkout(monkeypatch, seen)

    user_id = await _me(client, auth)
    async with AsyncSessionLocal() as db:
        user = await db.get(User, user_id)
        user.stripe_customer_id = "cus_42"  # paid before, then cancelled
        await db.commit()

    resp = await client.post("/api/v1/billing/checkout", json={"tier": "pro"}, headers=auth)
    assert resp.status_code == 200, resp.text
    assert seen["customer"] == "cus_42"
    assert seen["client_reference_id"] == user_id


async def test_a_first_time_buyer_sends_no_customer(client, auth, monkeypatch):
    monkeypatch.setattr(settings, "STRIPE_SECRET_KEY", "sk_test_1")
    seen: dict = {}
    _fake_checkout(monkeypatch, seen)
    await _me(client, auth)

    resp = await client.post("/api/v1/billing/checkout", json={"tier": "pro"}, headers=auth)
    assert resp.status_code == 200, resp.text
    assert "customer" not in seen, "an id Stripe has never issued cannot be sent"
