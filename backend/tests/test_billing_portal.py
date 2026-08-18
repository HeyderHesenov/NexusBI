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
    body = (await client.get("/api/v1/billing/usage", headers=auth)).json()
    assert body["payments_enabled"] is False
    assert body["has_subscription"] is False

    monkeypatch.setattr(settings, "STRIPE_SECRET_KEY", "sk_test_1")
    user_id = await _me(client, auth)
    async with AsyncSessionLocal() as db:
        user = await db.get(User, user_id)
        user.stripe_customer_id = "cus_42"
        await db.commit()

    body = (await client.get("/api/v1/billing/usage", headers=auth)).json()
    assert body["payments_enabled"] is True
    assert body["has_subscription"] is True
