"""Public dashboard sharing — token enable + unauthenticated read."""
from __future__ import annotations

from httpx import AsyncClient


async def test_share_and_public_access(client: AsyncClient, auth: dict):
    dash_id = (
        await client.post("/api/v1/dashboard/", json={"name": "Shared"}, headers=auth)
    ).json()["id"]

    share = await client.post(f"/api/v1/dashboard/{dash_id}/share", headers=auth)
    assert share.status_code == 200, share.text
    token = share.json()["token"]
    assert token

    # Public endpoint works WITHOUT auth headers, and carries the owner's brand.
    pub = await client.get(f"/api/v1/public/dashboard/{token}")
    assert pub.status_code == 200, pub.text
    body = pub.json()
    assert body["dashboard"]["name"] == "Shared"
    # A non-white-label owner gets NexusBI defaults (never the raw stored config).
    assert body["brand"] == {"app_name": "NexusBI", "primary_color": "#0E9F6E", "logo_url": ""}

    # Revoke → public link no longer resolves.
    assert (await client.delete(f"/api/v1/dashboard/{dash_id}/share", headers=auth)).status_code == 204
    assert (await client.get(f"/api/v1/public/dashboard/{token}")).status_code == 404


async def test_public_bad_token_404(client: AsyncClient):
    resp = await client.get("/api/v1/public/dashboard/does-not-exist")
    assert resp.status_code == 404
