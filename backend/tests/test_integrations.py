"""Workflow integrations: channel CRUD, SSRF guard, dispatch, @mentions."""
from __future__ import annotations

import pytest
from httpx import AsyncClient

from app.ai.types import ChartConfig, Text2SQLResult
from app.db.session import AsyncSessionLocal
from app.services import comment_service, digest_service, integrations, query_service


async def test_integration_channel_crud(client: AsyncClient, auth: dict):
    created = await client.post(
        "/api/v1/integrations",
        json={"type": "email", "name": "Komanda", "target": "team@nexusbi.io"},
        headers=auth,
    )
    assert created.status_code == 201, created.text
    cid = created.json()["id"]
    assert "target" not in created.json()  # secret never exposed

    listed = (await client.get("/api/v1/integrations", headers=auth)).json()
    assert len(listed) == 1

    # Mock delivery (INTEGRATIONS_LIVE False) → test returns ok.
    test = await client.post(f"/api/v1/integrations/{cid}/test", headers=auth)
    assert test.json()["ok"] is True

    await client.delete(f"/api/v1/integrations/{cid}", headers=auth)
    assert (await client.get("/api/v1/integrations", headers=auth)).json() == []


async def test_slack_webhook_ssrf_blocked(client: AsyncClient, auth: dict):
    resp = await client.post(
        "/api/v1/integrations",
        json={"type": "slack", "name": "bad", "target": "http://localhost/hook"},
        headers=auth,
    )
    assert resp.status_code >= 400  # loopback blocked by net_guard


async def test_digest_dispatches_to_channels(client: AsyncClient, auth: dict, monkeypatch):
    sent: list[str] = []

    async def spy(channel_type, target, title, body):
        sent.append(title)
        return True

    monkeypatch.setattr(integrations, "deliver", spy)

    async def fake_sql(self, nl, schema, dtype="sqlite", extra_context=""):
        return Text2SQLResult(sql="SELECT product_name, SUM(revenue) AS total FROM sales GROUP BY product_name", explanation="d", confidence=0.9)

    async def fake_chart(columns, data, nl):
        return ChartConfig(chart_type="bar")

    async def fake_insight(data, nl, chart_type=""):
        return ""

    monkeypatch.setattr(query_service.Text2SQLEngine, "generate_sql", fake_sql)
    monkeypatch.setattr(query_service, "select_chart_type", fake_chart)
    monkeypatch.setattr(query_service, "generate_insight", fake_insight)

    async def no_insight(*a, **k):
        return None

    monkeypatch.setattr(digest_service.insight_digest, "summarize_change", no_insight)

    await client.post(
        "/api/v1/integrations",
        json={"type": "email", "target": "me@nexusbi.io"},
        headers=auth,
    )
    await client.post(
        "/api/v1/query/ask", json={"nl_query": "məhsul gəliri", "datasource_id": None}, headers=auth
    )
    await client.post("/api/v1/notifications/digest", headers=auth)
    assert any(t.startswith("🌅") for t in sent)


async def test_mention_creates_notification(client: AsyncClient, auth: dict):
    # Register the user to be mentioned (keep their token).
    token2 = (
        await client.post(
            "/api/v1/auth/register",
            json={"email": "mentioned@nexusbi.io", "password": "pw1234", "full_name": "Mentioned"},
        )
    ).json()["access_token"]
    dash = (
        await client.post("/api/v1/dashboard/", json={"name": "D", "description": ""}, headers=auth)
    ).json()
    me = (await client.get("/api/v1/auth/me", headers=auth)).json()

    async with AsyncSessionLocal() as db:
        # Authenticated author (guests can't mention).
        await comment_service.create(
            db, dash["id"], me["id"], "Tester", "baxış lazımdır @mentioned@nexusbi.io"
        )
        await db.commit()

    notifs = (
        await client.get("/api/v1/notifications", headers={"Authorization": f"Bearer {token2}"})
    ).json()
    assert any(n["title"] == "Səni qeyd etdilər" for n in notifs)
