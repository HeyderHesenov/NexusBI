"""Requirements → dashboard: KPI extraction (AI + fallback) and build."""
from __future__ import annotations

import pytest
from httpx import AsyncClient

from app.ai import requirements
from app.ai.types import ChartConfig, Text2SQLResult
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


def test_rule_based_extraction():
    text = "Aylıq gəlir izlənməlidir.\nMüştəri sayı artmalıdır.\nNormal cümlə."
    out = requirements._rule_based(text)
    assert len(out["kpis"]) >= 2
    assert all(k["question"] for k in out["kpis"])


async def test_extract_endpoint_ai(client, auth, monkeypatch):
    async def fake_chat_json(system, user, **kw):
        return {
            "kpis": [
                {"name": "Gəlir", "question": "Aylıq gəlir trendi?", "rationale": "r", "requirement_ref": "x"}
            ]
        }

    monkeypatch.setattr(requirements, "chat_json", fake_chat_json)
    resp = await client.post(
        "/api/v1/requirements/extract",
        json={"name": "BRD", "text": "Gəlir artımı izlənməlidir."},
        headers=auth,
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["kpis"][0]["question"] == "Aylıq gəlir trendi?"
    assert body["name"] == "BRD"


async def test_extract_falls_back(client, auth, monkeypatch):
    async def boom(system, user, **kw):
        raise RuntimeError("ai down")

    monkeypatch.setattr(requirements, "chat_json", boom)
    resp = await client.post(
        "/api/v1/requirements/extract",
        json={"text": "Aylıq satış sayı izlənməlidir.\nGəlir trendi vacibdir."},
        headers=auth,
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["kpis"]  # rule-based produced something


async def test_extract_then_build(client, auth, monkeypatch):
    async def fake_chat_json(system, user, **kw):
        return {"kpis": [{"name": "Gəlir", "question": "Məhsul üzrə gəlir nədir?"}]}

    monkeypatch.setattr(requirements, "chat_json", fake_chat_json)
    doc = (
        await client.post(
            "/api/v1/requirements/extract",
            json={"text": "Gəlir izlənməlidir."},
            headers=auth,
        )
    ).json()

    resp = await client.post(
        f"/api/v1/requirements/{doc['id']}/build",
        json={"datasource_id": None},
        headers=auth,
    )
    assert resp.status_code == 201, resp.text
    dash = resp.json()
    assert dash["widgets"], "build should produce at least one widget"

    # The doc is now linked to the dashboard.
    docs = (await client.get("/api/v1/requirements", headers=auth)).json()
    assert docs[0]["dashboard_id"] == dash["id"]
