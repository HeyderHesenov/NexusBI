"""Multi-turn chat: previous query is threaded into the Text2SQL prompt."""
from __future__ import annotations

import pytest
from httpx import AsyncClient

from app.ai.types import ChartConfig, Text2SQLResult
from app.services import query_service


@pytest.fixture(autouse=True)
def _mock_ai(monkeypatch):
    captured = {}

    async def fake_sql(self, nl, schema, dtype="sqlite", extra_context=""):
        captured["ctx"] = extra_context
        return Text2SQLResult(
            sql="SELECT product_name, SUM(revenue) AS total FROM sales "
                "GROUP BY product_name ORDER BY total DESC LIMIT 5",
            confidence=0.9,
        )

    async def fake_chart(columns, data, nl):
        return ChartConfig(chart_type="bar", x_axis="product_name", y_axis="total")

    async def fake_insight(data, nl, chart_type=""):
        return "ok"

    monkeypatch.setattr(query_service.Text2SQLEngine, "generate_sql", fake_sql)
    monkeypatch.setattr(query_service, "select_chart_type", fake_chart)
    monkeypatch.setattr(query_service, "generate_insight", fake_insight)
    query_service._captured = captured  # type: ignore[attr-defined]


async def test_followup_includes_previous_context(client: AsyncClient, auth: dict):
    first = await client.post(
        "/api/v1/query/ask",
        json={"nl_query": "ən çox satan məhsullar", "datasource_id": None},
        headers=auth,
    )
    qid = first.json()["query_log_id"]

    follow = await client.post(
        "/api/v1/query/ask",
        json={
            "nl_query": "bunu aya görə böl",
            "datasource_id": None,
            "previous_query_log_id": qid,
        },
        headers=auth,
    )
    assert follow.status_code == 200, follow.text
    ctx = query_service._captured["ctx"]  # type: ignore[attr-defined]
    assert "ƏVVƏLKİ SUAL" in ctx
    assert "ən çox satan məhsullar" in ctx
