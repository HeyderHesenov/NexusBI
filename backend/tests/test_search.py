"""Global asset search — semantic ranking over metrics/saved queries, user-scoped."""
from __future__ import annotations

import pytest
from httpx import AsyncClient

pytestmark = pytest.mark.asyncio


async def _seed_assets(client: AsyncClient, auth: dict):
    await client.post(
        "/api/v1/metrics/",
        json={"name": "Müştəri itkisi", "description": "churn rate aylıq", "synonyms": "churn"},
        headers=auth,
    )
    await client.post(
        "/api/v1/saved/",
        json={"name": "Regional gəlir", "nl_query": "region üzrə satış"},
        headers=auth,
    )


async def test_search_finds_relevant_asset(client: AsyncClient, auth: dict):
    await _seed_assets(client, auth)
    resp = await client.get("/api/v1/search", params={"q": "churn"}, headers=auth)
    assert resp.status_code == 200, resp.text
    hits = resp.json()
    assert hits, "expected at least one hit"
    # The churn metric should rank first for a churn query.
    assert hits[0]["kind"] == "metric_asset"
    assert "itki" in hits[0]["title"].lower() or "churn" in hits[0]["title"].lower()
    assert all("ref_id" in h and "score" in h for h in hits)


async def test_search_is_user_scoped(client: AsyncClient, auth: dict):
    await _seed_assets(client, auth)
    other = await client.post(
        "/api/v1/auth/register",
        json={"email": "other@nexusbi.io", "password": "pw1234", "full_name": "O"},
    )
    other_auth = {"Authorization": f"Bearer {other.json()['access_token']}"}
    # Another user searching the same term must not see the first user's assets.
    resp = await client.get("/api/v1/search", params={"q": "churn"}, headers=other_auth)
    assert resp.status_code == 200
    assert resp.json() == []


async def test_reindex_returns_count(client: AsyncClient, auth: dict):
    await _seed_assets(client, auth)
    # First search bootstraps the index; reindex after no change embeds nothing.
    await client.get("/api/v1/search", params={"q": "x"}, headers=auth)
    resp = await client.post("/api/v1/search/reindex", headers=auth)
    assert resp.status_code == 200
    assert resp.json()["indexed"] == 0


async def test_reindex_picks_up_new_asset(client: AsyncClient, auth: dict):
    await client.get("/api/v1/search", params={"q": "x"}, headers=auth)  # bootstrap (empty)
    await client.post(
        "/api/v1/metrics/", json={"name": "Yeni metrik", "description": "gəlir"}, headers=auth
    )
    resp = await client.post("/api/v1/search/reindex", headers=auth)
    assert resp.json()["indexed"] == 1


async def test_reindex_prunes_deleted_asset(client: AsyncClient, auth: dict):
    created = await client.post(
        "/api/v1/metrics/", json={"name": "Silinəcək metrik", "description": "churn"}, headers=auth
    )
    mid = created.json()["id"]
    # Bootstrap index, confirm it's findable.
    found = await client.get("/api/v1/search", params={"q": "churn"}, headers=auth)
    assert any(h["ref_id"] == mid for h in found.json())

    await client.delete(f"/api/v1/metrics/{mid}", headers=auth)
    await client.post("/api/v1/search/reindex", headers=auth)  # prunes the orphan

    after = await client.get("/api/v1/search", params={"q": "churn"}, headers=auth)
    assert all(h["ref_id"] != mid for h in after.json())


async def test_search_requires_auth(client: AsyncClient):
    resp = await client.get("/api/v1/search", params={"q": "x"})
    assert resp.status_code == 401
