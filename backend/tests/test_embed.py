"""Embed tokens, white-label branding, and Stripe checkout gating."""
from __future__ import annotations

from httpx import AsyncClient

# The registered test user (see conftest) starts on the free tier.
_TEST_EMAIL = "test@nexusbi.io"


async def _make_dashboard(client: AsyncClient, auth: dict) -> str:
    resp = await client.post(
        "/api/v1/dashboard/", json={"name": "Embed me", "description": "x"}, headers=auth
    )
    return resp.json()["id"]


async def _set_tier(tier: str, email: str = _TEST_EMAIL) -> None:
    """Flip a user's subscription tier directly (the /billing/upgrade mock only
    runs in DEMO_MODE, which tests don't enable)."""
    from sqlalchemy import update

    from app.db.session import AsyncSessionLocal
    from app.models.user import User

    async with AsyncSessionLocal() as db:
        await db.execute(update(User).where(User.email == email).values(subscription_tier=tier))
        await db.commit()


async def test_embed_enable_and_public_view(client: AsyncClient, auth: dict):
    did = await _make_dashboard(client, auth)
    toggle = await client.patch(f"/api/v1/dashboard/{did}/embed", json={"enabled": True}, headers=auth)
    assert toggle.status_code == 200, toggle.text
    token = toggle.json()["token"]
    assert token

    # Public, unauthenticated embed view works and carries brand defaults.
    view = await client.get(f"/api/v1/public/embed/{token}")
    assert view.status_code == 200, view.text
    body = view.json()
    assert body["dashboard"]["id"] == did
    assert body["brand"]["app_name"] == "NexusBI"


async def test_embed_disable_revokes_access(client: AsyncClient, auth: dict):
    did = await _make_dashboard(client, auth)
    token = (
        await client.patch(f"/api/v1/dashboard/{did}/embed", json={"enabled": True}, headers=auth)
    ).json()["token"]
    await client.patch(f"/api/v1/dashboard/{did}/embed", json={"enabled": False}, headers=auth)
    view = await client.get(f"/api/v1/public/embed/{token}")
    assert view.status_code == 404  # embed disabled → not found


async def test_embed_invalid_token(client: AsyncClient):
    resp = await client.get("/api/v1/public/embed/not-a-real-token")
    assert resp.status_code == 401


async def test_branding_get_default_and_update(client: AsyncClient, auth: dict):
    default = (await client.get("/api/v1/brand", headers=auth)).json()
    assert default["app_name"] == "NexusBI"

    await _set_tier("pro")  # white-label is a paid capability
    updated = (
        await client.put(
            "/api/v1/brand",
            json={"app_name": "AcmeBI", "primary_color": "#FF5500"},
            headers=auth,
        )
    ).json()
    assert updated["app_name"] == "AcmeBI"
    assert updated["primary_color"] == "#FF5500"

    # Persisted.
    again = (await client.get("/api/v1/brand", headers=auth)).json()
    assert again["app_name"] == "AcmeBI"


async def test_branding_reflected_in_embed(client: AsyncClient, auth: dict):
    await _set_tier("pro")
    await client.put("/api/v1/brand", json={"app_name": "WhiteLabel Co"}, headers=auth)
    did = await _make_dashboard(client, auth)
    token = (
        await client.patch(f"/api/v1/dashboard/{did}/embed", json={"enabled": True}, headers=auth)
    ).json()["token"]
    view = (await client.get(f"/api/v1/public/embed/{token}")).json()
    assert view["brand"]["app_name"] == "WhiteLabel Co"


async def test_branding_put_requires_paid_plan(client: AsyncClient, auth: dict):
    # Free tier cannot set white-label branding.
    resp = await client.put("/api/v1/brand", json={"app_name": "AcmeBI"}, headers=auth)
    assert resp.status_code == 403
    assert resp.json()["detail"] == "white_label_requires_plan"


async def test_embed_falls_back_to_default_brand_after_downgrade(client: AsyncClient, auth: dict):
    # Pro owner sets a brand and enables an embed...
    await _set_tier("pro")
    await client.put("/api/v1/brand", json={"app_name": "WhiteLabel Co"}, headers=auth)
    did = await _make_dashboard(client, auth)
    token = (
        await client.patch(f"/api/v1/dashboard/{did}/embed", json={"enabled": True}, headers=auth)
    ).json()["token"]
    # ...then downgrades to free → the embed reverts to default NexusBI branding
    # (stored config is never leaked on a non-white-label tier).
    await _set_tier("free")
    view = (await client.get(f"/api/v1/public/embed/{token}")).json()
    assert view["brand"]["app_name"] == "NexusBI"


async def test_branding_rejects_unsafe_values(client: AsyncClient, auth: dict):
    bad_color = await client.put("/api/v1/brand", json={"primary_color": "red"}, headers=auth)
    assert bad_color.status_code == 422
    bad_logo = await client.put(
        "/api/v1/brand", json={"logo_url": "javascript:alert(1)"}, headers=auth
    )
    assert bad_logo.status_code == 422
    bad_name = await client.put(
        "/api/v1/brand", json={"app_name": "<img src=x onerror=alert(1)>"}, headers=auth
    )
    assert bad_name.status_code == 422


async def test_stripe_checkout_gated(client: AsyncClient, auth: dict):
    # No STRIPE_SECRET_KEY in tests → refused (mock /upgrade is the demo path).
    resp = await client.post("/api/v1/billing/checkout", json={"tier": "pro"}, headers=auth)
    assert resp.status_code >= 400
    assert resp.json()["detail"] == "stripe_not_configured"
