"""Root-cause decomposition tree — AI tree + rule-based fallback."""
from __future__ import annotations

import pytest
from httpx import AsyncClient

from app.ai import root_cause
from app.ai.types import ChartConfig, Text2SQLResult
from app.core.exceptions import AIGenerationError
from app.services import query_service


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
        json={"nl_query": "Məhsul üzrə gəlir", "datasource_id": None},
        headers=auth,
    )
    return resp.json()["query_log_id"]


def test_rule_based_decomposition():
    rows = [{"region": "West", "total": 60}, {"region": "East", "total": 40}]
    out = root_cause._rule_based("region", "total", rows)
    assert out["metric"] == "total"
    assert out["total"] == 100
    assert out["drivers"][0]["label"] == "West"
    assert out["drivers"][0]["contribution_pct"] == 60.0
    assert out["drivers"][0]["direction"] == "up"


async def test_root_cause_ai_tree(client, auth, monkeypatch):
    async def fake_chat_json(system, user, **kw):
        return {
            "metric": "total",
            "total": 1000,
            "summary": "Qərb aparıcıdır.",
            "drivers": [
                {
                    "label": "Qərb", "value": 620, "contribution_pct": 62.0, "direction": "up",
                    "children": [
                        {"label": "Laptop", "value": 400, "contribution_pct": 64.0, "direction": "up"}
                    ],
                }
            ],
        }

    monkeypatch.setattr(root_cause, "chat_json", fake_chat_json)
    qid = await _make_query(client, auth)
    resp = await client.post(f"/api/v1/query/{qid}/root-cause", headers=auth)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["drivers"][0]["label"] == "Qərb"
    assert body["drivers"][0]["children"][0]["label"] == "Laptop"
    assert body["summary"]


async def test_root_cause_falls_back_on_ai_error(client, auth, monkeypatch):
    async def boom(system, user, **kw):
        raise AIGenerationError("down")

    monkeypatch.setattr(root_cause, "chat_json", boom)
    qid = await _make_query(client, auth)
    resp = await client.post(f"/api/v1/query/{qid}/root-cause", headers=auth)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    # Deterministic fallback over the demo result still yields drivers.
    assert body["drivers"]
    assert body["drivers"][0]["contribution_pct"] is not None


async def test_root_cause_falls_back_on_malformed_ai(client, auth, monkeypatch):
    # AI returns a non-empty driver list with a node MISSING the required label.
    async def malformed(system, user, **kw):
        return {"summary": "x", "drivers": [{"value": 1, "contribution_pct": 50}]}

    monkeypatch.setattr(root_cause, "chat_json", malformed)
    qid = await _make_query(client, auth)
    resp = await client.post(f"/api/v1/query/{qid}/root-cause", headers=auth)
    # Must degrade to the rule-based tree, not 500.
    assert resp.status_code == 200, resp.text
    assert resp.json()["drivers"][0]["label"]


def test_rule_based_mixed_sign_share_sums_to_100():
    rows = [{"r": "A", "v": 100}, {"r": "B", "v": -40}, {"r": "C", "v": 60}]
    out = root_cause._rule_based("r", "v", rows)
    pct_sum = sum(d["contribution_pct"] for d in out["drivers"])
    assert 99.0 <= pct_sum <= 101.0
    assert all(d["contribution_pct"] >= 0 for d in out["drivers"])
    assert next(d for d in out["drivers"] if d["label"] == "B")["direction"] == "down"
