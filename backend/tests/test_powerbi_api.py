"""End-to-end Power BI datasource: connect + live DAX query (AI mocked)."""
from __future__ import annotations

import pytest
from httpx import AsyncClient

from app.ai.types import ChartConfig, DAXResult
from app.services import query_service


@pytest.fixture(autouse=True)
def _mock_ai(monkeypatch):
    async def fake_dax(self, nl, schema, extra_context=""):
        return DAXResult(
            dax="EVALUATE SUMMARIZECOLUMNS('Sales'[category], \"Total\", SUM('Sales'[revenue]))",
            explanation="d", confidence=0.9,
        )

    async def fake_chart(columns, data, nl):
        return ChartConfig(chart_type="bar", x_axis="category", y_axis="Total")

    async def fake_insight(data, nl, chart_type=""):
        return "ok"

    monkeypatch.setattr(query_service.Text2DAXEngine, "generate_dax", fake_dax)
    monkeypatch.setattr(query_service, "select_chart_type", fake_chart)
    monkeypatch.setattr(query_service, "generate_insight", fake_insight)


async def _connect(client: AsyncClient, auth: dict) -> str:
    resp = await client.post(
        "/api/v1/datasource/connect-powerbi",
        json={"name": "My Power BI", "dataset_id": "sales-model"},
        headers=auth,
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["db_type"] == "powerbi"
    return body["id"]


async def test_list_powerbi_datasets(client: AsyncClient, auth: dict):
    resp = await client.get("/api/v1/datasource/powerbi/datasets", headers=auth)
    assert resp.status_code == 200
    datasets = resp.json()
    assert any(d["id"] == "sales-model" for d in datasets)


async def test_connect_and_query_powerbi(client: AsyncClient, auth: dict):
    ds_id = await _connect(client, auth)

    resp = await client.post(
        "/api/v1/query/ask",
        json={"nl_query": "kateqoriya üzrə gəlir", "datasource_id": ds_id},
        headers=auth,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["query_language"] == "dax"
    assert body["sql"].upper().startswith("EVALUATE")
    assert body["data"]  # rows returned from the mock provider
    assert body["chart_config"]["chart_type"] == "bar"


async def test_powerbi_schema_endpoint(client: AsyncClient, auth: dict):
    ds_id = await _connect(client, auth)
    resp = await client.get(f"/api/v1/datasource/{ds_id}/schema", headers=auth)
    assert resp.status_code == 200
    assert "Sales" in resp.json()


async def test_powerbi_offline_fallback(client: AsyncClient, auth: dict, monkeypatch):
    """When NL->DAX fails, the rule-based DAX fallback still returns data."""
    from app.core.exceptions import AIGenerationError

    async def boom(self, nl, schema, extra_context=""):
        raise AIGenerationError("AI down")

    monkeypatch.setattr(query_service.Text2DAXEngine, "generate_dax", boom)
    ds_id = await _connect(client, auth)
    resp = await client.post(
        "/api/v1/query/ask",
        json={"nl_query": "top 5 products by revenue", "datasource_id": ds_id},
        headers=auth,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["query_language"] == "dax"
    assert body["data"]
