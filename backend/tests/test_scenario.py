"""Scenario planning: goal-seek, Monte Carlo, KPI pacing."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.ai.types import ChartConfig, Text2SQLResult
from app.services import query_service, scenario_service


@pytest.fixture(autouse=True)
def _mock_ai(monkeypatch):
    async def fake_sql(self, nl, schema, dtype="sqlite", extra_context=""):
        return Text2SQLResult(
            sql="SELECT product_name, SUM(revenue) AS total FROM sales GROUP BY product_name",
            explanation="d", confidence=0.9,
        )

    async def fake_chart(columns, data, nl):
        return ChartConfig(chart_type="bar", x_axis="product_name", y_axis="total")

    async def fake_insight(data, nl, chart_type=""):
        return "ok"

    monkeypatch.setattr(query_service.Text2SQLEngine, "generate_sql", fake_sql)
    monkeypatch.setattr(query_service, "select_chart_type", fake_chart)
    monkeypatch.setattr(query_service, "generate_insight", fake_insight)


def test_goal_seek():
    out = scenario_service.goal_seek([100, 120, 150], 300)
    assert out["current"] == 150
    assert out["gap"] == 150
    assert out["required_pct"] == 100.0  # 150 → 300 is +100%


def test_monte_carlo_deterministic_and_ordered():
    a = scenario_service.monte_carlo([100, 110, 121, 133], periods=4, runs=500, seed=42)
    b = scenario_service.monte_carlo([100, 110, 121, 133], periods=4, runs=500, seed=42)
    assert a == b  # same seed → reproducible
    assert len(a["bands"]) == 4
    for band in a["bands"]:
        assert band["p10"] <= band["p50"] <= band["p90"]


def test_monte_carlo_needs_two_points():
    with pytest.raises(ValueError):
        scenario_service.monte_carlo([100], periods=3)


def test_pacing_ahead_and_behind():
    start = datetime.now(timezone.utc) - timedelta(days=15)  # ~50% through a month
    ahead = scenario_service.pacing(1000, 800, "month", start)
    assert ahead["on_track"] is True
    behind = scenario_service.pacing(1000, 100, "month", start)
    assert behind["on_track"] is False
    assert behind["status"] == "geridə"


async def test_kpi_target_crud(client, auth):
    created = (
        await client.post(
            "/api/v1/kpi-targets",
            json={"name": "Aylıq gəlir", "target_value": 1000, "current_value": 400, "period": "month"},
            headers=auth,
        )
    ).json()
    assert created["pacing"]["attainment_pct"] == 40.0

    updated = (
        await client.patch(
            f"/api/v1/kpi-targets/{created['id']}", json={"current_value": 900}, headers=auth
        )
    ).json()
    assert updated["pacing"]["attainment_pct"] == 90.0

    items = (await client.get("/api/v1/kpi-targets", headers=auth)).json()
    assert len(items) == 1


async def test_query_goal_seek_and_monte_carlo(client, auth):
    qid = (
        await client.post(
            "/api/v1/query/ask",
            json={"nl_query": "məhsul gəliri", "datasource_id": None},
            headers=auth,
        )
    ).json()["query_log_id"]

    gs = await client.post(f"/api/v1/query/{qid}/goal-seek", json={"target": 99999}, headers=auth)
    assert gs.status_code == 200, gs.text
    assert "required_pct" in gs.json()

    mc = await client.post(
        f"/api/v1/query/{qid}/monte-carlo", json={"periods": 3, "runs": 200}, headers=auth
    )
    assert mc.status_code == 200, mc.text
    assert len(mc.json()["bands"]) == 3
