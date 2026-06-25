"""Rate-limit + billing tests — quota enforcement, upgrade, usage."""
from __future__ import annotations

import pytest
from httpx import AsyncClient

from app.ai.types import ChartConfig, Text2SQLResult
from app.billing import tiers
from app.services import query_service


@pytest.fixture(autouse=True)
def _mock_ai(monkeypatch):
    async def fake_sql(self, nl, schema, dtype="sqlite"):
        return Text2SQLResult(sql="SELECT 1 AS n", explanation="d", confidence=0.9)

    async def fake_chart(columns, data, nl):
        return ChartConfig(chart_type="bar", x_axis="n", y_axis="n")

    async def fake_insight(data, nl, chart_type=""):
        return "ok"

    monkeypatch.setattr(query_service.Text2SQLEngine, "generate_sql", fake_sql)
    monkeypatch.setattr(query_service, "select_chart_type", fake_chart)
    monkeypatch.setattr(query_service, "generate_insight", fake_insight)


@pytest.fixture
def _small_free_quota(monkeypatch):
    """Shrink the Free quota to 2 so exhaustion is cheap to test."""
    small = tiers.Tier(key="free", name="Free", price_usd=0, monthly_quota=2, features=[])
    monkeypatch.setitem(tiers.TIERS, "free", small)


async def _ask(client: AsyncClient, auth: dict):
    return await client.post(
        "/api/v1/query/ask", json={"nl_query": "x", "datasource_id": None}, headers=auth
    )


async def test_quota_exhaustion_returns_429(client, auth, _small_free_quota):
    assert (await _ask(client, auth)).status_code == 200
    assert (await _ask(client, auth)).status_code == 200
    blocked = await _ask(client, auth)
    assert blocked.status_code == 429, blocked.text


async def test_upgrade_raises_limit(client, auth, _small_free_quota):
    await _ask(client, auth)
    await _ask(client, auth)
    assert (await _ask(client, auth)).status_code == 429

    up = await client.post("/api/v1/billing/upgrade", json={"tier": "pro"}, headers=auth)
    assert up.status_code == 200
    assert up.json()["tier"] == "pro"
    # Pro quota (300) is far above the 2 consumed → next call succeeds.
    assert (await _ask(client, auth)).status_code == 200


async def test_usage_reflects_consumption(client, auth):
    before = await client.get("/api/v1/billing/usage", headers=auth)
    assert before.json()["used"] == 0
    await _ask(client, auth)
    after = await client.get("/api/v1/billing/usage", headers=auth)
    body = after.json()
    assert body["used"] == 1
    assert body["remaining"] == body["limit"] - 1


async def test_unlimited_tier_bypasses_limit(client, auth, _small_free_quota):
    # Switch to the unlimited (demo) tier, then exceed the tiny free quota freely.
    up = await client.post("/api/v1/billing/upgrade", json={"tier": "unlimited"}, headers=auth)
    assert up.status_code == 200
    body = up.json()
    assert body["tier"] == "unlimited"
    assert body["limit"] == -1
    for _ in range(5):  # well past the free quota of 2
        assert (await _ask(client, auth)).status_code == 200


async def test_plans_catalogue(client, auth):
    resp = await client.get("/api/v1/billing/plans", headers=auth)
    plans = {p["key"]: p for p in resp.json()}
    assert plans["pro"]["price_usd"] == 20
    assert plans["max"]["monthly_quota"] == 1500
    assert plans["max_plus"]["monthly_quota"] == 3000
