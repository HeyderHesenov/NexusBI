"""Metric (semantic layer) CRUD + injection into the Text2SQL prompt."""
from __future__ import annotations

import pytest
from httpx import AsyncClient

from app.ai.types import ChartConfig, Text2SQLResult
from app.services import query_service


async def test_metric_crud(client: AsyncClient, auth: dict):
    created = await client.post(
        "/api/v1/metrics/",
        json={"name": "Gəlir", "expression": "SUM(revenue)", "synonyms": "satış, dövriyyə"},
        headers=auth,
    )
    assert created.status_code == 201, created.text
    mid = created.json()["id"]

    listed = await client.get("/api/v1/metrics/", headers=auth)
    assert any(m["id"] == mid for m in listed.json())

    assert (await client.delete(f"/api/v1/metrics/{mid}", headers=auth)).status_code == 204


async def test_metric_injected_into_prompt(client: AsyncClient, auth: dict, monkeypatch):
    captured = {}

    async def capture_sql(self, nl, schema, dtype="sqlite", extra_context=""):
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

    monkeypatch.setattr(query_service.Text2SQLEngine, "generate_sql", capture_sql)
    monkeypatch.setattr(query_service, "select_chart_type", fake_chart)
    monkeypatch.setattr(query_service, "generate_insight", fake_insight)

    # Create a global (demo) metric, then run a demo query.
    await client.post(
        "/api/v1/metrics/",
        json={"name": "Gəlir", "expression": "SUM(revenue)"},
        headers=auth,
    )
    resp = await client.post(
        "/api/v1/query/ask",
        json={"nl_query": "ən çox satan", "datasource_id": None},
        headers=auth,
    )
    assert resp.status_code == 200, resp.text
    assert "Gəlir" in captured["ctx"]  # metric definition reached the prompt
    assert "SUM(revenue)" in captured["ctx"]
