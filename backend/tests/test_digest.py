"""Proactive AI digest (morning brief) tests — AI mocked, rule-based fallback covered."""
from __future__ import annotations

from datetime import datetime, timezone

import pytest
from httpx import AsyncClient

from app.ai.types import ChartConfig, Text2SQLResult
from app.config import settings
from app.db.session import AsyncSessionLocal
from app.services import digest_service, query_service


@pytest.fixture(autouse=True)
def _mock_ai(monkeypatch):
    async def fake_sql(self, nl, schema, dtype="sqlite", extra_context=""):
        return Text2SQLResult(
            sql="SELECT product_name, SUM(revenue) AS total FROM sales "
                "GROUP BY product_name ORDER BY total DESC LIMIT 5",
            explanation="d", confidence=0.9,
        )

    async def fake_chart(columns, data, nl):
        return ChartConfig(chart_type="bar", x_axis="product_name", y_axis="total")

    async def fake_insight(data, nl, chart_type=""):
        return "ok"

    monkeypatch.setattr(query_service.Text2SQLEngine, "generate_sql", fake_sql)
    monkeypatch.setattr(query_service, "select_chart_type", fake_chart)
    monkeypatch.setattr(query_service, "generate_insight", fake_insight)


async def _make_query(client: AsyncClient, auth: dict) -> str:
    resp = await client.post(
        "/api/v1/query/ask",
        json={"nl_query": "Ən çox satan məhsullar", "datasource_id": None},
        headers=auth,
    )
    return resp.json()["query_log_id"]


def test_rule_based_highlight_picks_leader():
    rows = [{"product_name": "Laptop", "total": 800}, {"product_name": "Mouse", "total": 200}]
    out = digest_service._rule_based_highlight(rows)
    assert out is not None
    assert "Laptop" in out and "80%" in out


def test_rule_based_highlight_no_numeric():
    assert digest_service._rule_based_highlight([{"name": "x"}]) is None
    assert digest_service._rule_based_highlight([]) is None


async def test_digest_endpoint_ai(client, auth, monkeypatch):
    async def fake_summarize(nl, prev, curr):
        return "Gəlir 12% artıb."

    monkeypatch.setattr(digest_service.insight_digest, "summarize_change", fake_summarize)
    await _make_query(client, auth)

    resp = await client.post("/api/v1/notifications/digest", headers=auth)
    assert resp.status_code == 200, resp.text
    assert resp.json()["created"] == 1

    notifs = (await client.get("/api/v1/notifications", headers=auth)).json()
    brief = next((n for n in notifs if n["title"].startswith("🌅")), None)
    assert brief is not None
    assert "Gəlir 12% artıb." in brief["body"]


async def test_digest_endpoint_fallback(client, auth, monkeypatch):
    # AI digest yields nothing notable → deterministic rule-based highlight is used.
    async def fake_summarize(nl, prev, curr):
        return None

    monkeypatch.setattr(digest_service.insight_digest, "summarize_change", fake_summarize)
    await _make_query(client, auth)

    resp = await client.post("/api/v1/notifications/digest", headers=auth)
    assert resp.json()["created"] == 1
    notifs = (await client.get("/api/v1/notifications", headers=auth)).json()
    brief = next((n for n in notifs if n["title"].startswith("🌅")), None)
    assert brief is not None
    assert "Lider:" in brief["body"]


async def test_digest_empty_when_no_queries(client, auth):
    resp = await client.post("/api/v1/notifications/digest", headers=auth)
    assert resp.json()["created"] == 0


async def test_run_digests_due_gating(client, auth, monkeypatch):
    async def fake_summarize(nl, prev, curr):
        return None

    monkeypatch.setattr(digest_service.insight_digest, "summarize_change", fake_summarize)
    await _make_query(client, auth)
    # Gate to the current hour so the scheduler branch actually fires in-test.
    monkeypatch.setattr(settings, "DIGEST_HOUR_UTC", datetime.now(timezone.utc).hour)

    async with AsyncSessionLocal() as db:
        created = await digest_service.run_digests_due(db)
        await db.commit()
    assert created >= 1

    # Second run the same day is a no-op (last_digest_at stamped).
    async with AsyncSessionLocal() as db:
        again = await digest_service.run_digests_due(db)
        await db.commit()
    assert again == 0
