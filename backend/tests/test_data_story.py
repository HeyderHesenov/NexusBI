"""AI data-story endpoint: assembly, fallback, ownership."""
from __future__ import annotations

from httpx import AsyncClient


def _mock_query_ai(monkeypatch):
    from app.ai.types import ChartConfig, Text2SQLResult
    from app.services import query_service

    async def fake_sql(self, nl, schema, dtype="sqlite", extra_context=""):
        return Text2SQLResult(
            sql="SELECT region, SUM(revenue) AS total FROM sales GROUP BY region",
            explanation="x", confidence=0.9, warnings=[],
        )

    async def fake_chart(columns, data, nl):
        return ChartConfig(chart_type="bar", x_axis="region", y_axis="total")

    async def fake_insight(data, nl, chart_type=""):
        return "Qərb liderdir."

    monkeypatch.setattr(query_service.Text2SQLEngine, "generate_sql", fake_sql)
    monkeypatch.setattr(query_service, "select_chart_type", fake_chart)
    monkeypatch.setattr(query_service, "generate_insight", fake_insight)


async def _dashboard_with_widget(client: AsyncClient, auth: dict) -> str:
    qid = (
        await client.post(
            "/api/v1/query/ask",
            json={"nl_query": "Region üzrə gəlir", "datasource_id": None},
            headers=auth,
        )
    ).json()["query_log_id"]
    dash_id = (
        await client.post("/api/v1/dashboard/", json={"name": "Satış"}, headers=auth)
    ).json()["id"]
    await client.post(
        f"/api/v1/dashboard/{dash_id}/widget",
        json={"query_log_id": qid, "title": "Region gəliri"},
        headers=auth,
    )
    return dash_id


async def test_story_uses_ai(client: AsyncClient, auth: dict, monkeypatch):
    _mock_query_ai(monkeypatch)
    dash_id = await _dashboard_with_widget(client, auth)

    from app.ai import data_story

    async def fake_chat_json(system, user, *, temperature=0.0):
        return {
            "title": "Satış hekayəsi",
            "overview": "Panel regional gəliri göstərir.",
            "slides": [{"index": 0, "narrative": "Qərb regionu öndədir."}],
            "takeaways": ["Qərbə fokuslan."],
        }

    monkeypatch.setattr(data_story, "chat_json", fake_chat_json)

    resp = await client.post(f"/api/v1/dashboard/{dash_id}/story", headers=auth)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["title"] == "Satış hekayəsi"
    types = [s["type"] for s in body["slides"]]
    assert types == ["intro", "chart", "closing"]
    chart_slide = body["slides"][1]
    assert chart_slide["narrative"] == "Qərb regionu öndədir."
    assert chart_slide["widget_id"]


async def test_story_falls_back_on_ai_error(client: AsyncClient, auth: dict, monkeypatch):
    _mock_query_ai(monkeypatch)
    dash_id = await _dashboard_with_widget(client, auth)

    from app.ai import data_story
    from app.core.exceptions import AIGenerationError

    async def boom(system, user, *, temperature=0.0):
        raise AIGenerationError("down", detail="x")

    monkeypatch.setattr(data_story, "chat_json", boom)

    resp = await client.post(f"/api/v1/dashboard/{dash_id}/story", headers=auth)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    # Fallback still produces intro + per-widget + closing using the insight.
    assert [s["type"] for s in body["slides"]] == ["intro", "chart", "closing"]
    assert "Qərb liderdir." in body["slides"][1]["narrative"]


async def test_story_requires_ownership(client: AsyncClient, auth: dict):
    resp = await client.post(
        "/api/v1/dashboard/00000000-0000-0000-0000-000000000000/story", headers=auth
    )
    assert resp.status_code == 404
