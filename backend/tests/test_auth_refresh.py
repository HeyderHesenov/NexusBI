"""Refresh-token rotation, reuse detection, and logout revocation."""
from __future__ import annotations

import pytest


async def _register(client, email="rt@example.com"):
    r = await client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": "secret123", "full_name": "RT"},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["access_token"] and body["refresh_token"]
    return body


@pytest.mark.asyncio
async def test_register_returns_token_pair(client):
    body = await _register(client)
    assert body["token_type"] == "bearer"


@pytest.mark.asyncio
async def test_rotation_chain_issues_fresh_distinct_tokens(client):
    # Rotating forward repeatedly works and each token is distinct. (Replaying an
    # OLD token is reuse — covered by test_reuse_revokes_whole_family.)
    body = await _register(client, "rotate@example.com")
    t0 = body["refresh_token"]
    t1 = (await client.post("/api/v1/auth/refresh", json={"refresh_token": t0})).json()[
        "refresh_token"
    ]
    r2 = await client.post("/api/v1/auth/refresh", json={"refresh_token": t1})
    assert r2.status_code == 200
    t2 = r2.json()["refresh_token"]
    assert len({t0, t1, t2}) == 3


@pytest.mark.asyncio
async def test_reuse_revokes_whole_family(client):
    body = await _register(client, "reuse@example.com")
    first = body["refresh_token"]
    # Rotate once → first is now revoked, second is live.
    second = (
        await client.post("/api/v1/auth/refresh", json={"refresh_token": first})
    ).json()["refresh_token"]
    # Replay the revoked `first` → reuse detected, family killed.
    replay = await client.post("/api/v1/auth/refresh", json={"refresh_token": first})
    assert replay.status_code == 401
    # The previously-live `second` is now revoked too (family containment).
    after = await client.post("/api/v1/auth/refresh", json={"refresh_token": second})
    assert after.status_code == 401


@pytest.mark.asyncio
async def test_logout_revokes_refresh(client):
    body = await _register(client, "logout@example.com")
    refresh = body["refresh_token"]
    out = await client.post("/api/v1/auth/logout", json={"refresh_token": refresh})
    assert out.status_code == 204
    after = await client.post("/api/v1/auth/refresh", json={"refresh_token": refresh})
    assert after.status_code == 401


@pytest.mark.asyncio
async def test_refresh_token_rejected_as_access_token(client):
    # A refresh token must NOT authenticate protected API calls (token confusion).
    body = await _register(client, "confuse@example.com")
    r = await client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {body['refresh_token']}"},
    )
    assert r.status_code == 401
    # The access token still works at the same endpoint.
    ok = await client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {body['access_token']}"},
    )
    assert ok.status_code == 200


@pytest.mark.asyncio
async def test_access_token_rejected_at_refresh(client):
    body = await _register(client, "accessonly@example.com")
    # An access token carries no "rt" claim → must be rejected at /refresh.
    r = await client.post("/api/v1/auth/refresh", json={"refresh_token": body["access_token"]})
    assert r.status_code == 401
