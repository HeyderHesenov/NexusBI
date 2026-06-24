"""Query API tests — full pipeline in demo mode with AI mocked."""
from __future__ import annotations

import pytest
from httpx import AsyncClient

from app.ai.types import ChartConfig, Text2SQLResult
from app.services import query_service


@pytest.fixture(autouse=True)
def _mock_ai(monkeypatch):
    async def fake_sql(self, nl, schema, dtype="sqlite"):
        return Text2SQLResult(
            sql="SELECT product_name, SUM(revenue) AS total FROM sales "
                "GROUP BY product_name ORDER BY total DESC LIMIT 5",
            explanation="demo", confidence=0.9, warnings=[],
        )

    async def fake_chart(columns, data, nl):
        return ChartConfig(chart_type="bar", x_axis="product_name", y_axis="total")

    async def fake_insight(data, nl, chart_type=""):
        return "Ən çox satan məhsul liderdir."

    monkeypatch.setattr(query_service.Text2SQLEngine, "generate_sql", fake_sql)
    monkeypatch.setattr(query_service, "select_chart_type", fake_chart)
    monkeypatch.setattr(query_service, "generate_insight", fake_insight)


async def test_full_query_pipeline(client: AsyncClient, auth: dict):
    resp = await client.post(
        "/api/v1/query/ask",
        json={"nl_query": "Ən çox satan 5 məhsul", "datasource_id": None},
        headers=auth,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["chart_config"]["chart_type"] == "bar"
    assert len(body["data"]) == 5
    assert body["insight"]
    assert body["query_log_id"]

    # history reflects the query
    hist = await client.get("/api/v1/query/history", headers=auth)
    assert hist.json()["total"] >= 1


async def test_unauthorized_access(client: AsyncClient):
    resp = await client.post(
        "/api/v1/query/ask", json={"nl_query": "x", "datasource_id": None}
    )
    assert resp.status_code == 401


async def test_invalid_datasource(client: AsyncClient, auth: dict):
    resp = await client.post(
        "/api/v1/query/ask",
        json={"nl_query": "x", "datasource_id": "does-not-exist"},
        headers=auth,
    )
    assert resp.status_code == 404
