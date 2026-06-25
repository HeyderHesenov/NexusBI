"""Alert (monitor) evaluation + notifications."""
from __future__ import annotations

import pytest
from httpx import AsyncClient

from app.ai.types import ChartConfig, Text2SQLResult
from app.services import query_service


@pytest.fixture(autouse=True)
def _mock_ai(monkeypatch):
    async def fake_sql(self, nl, schema, dtype="sqlite", extra_context=""):
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


def test_evaluate_logic():
    from app.models.alert import Alert
    from app.services import alert_service

    a = Alert(column="total", operator=">", threshold=100)
    assert alert_service.evaluate(a, [{"total": 50}, {"total": 200}]) is True
    assert alert_service.evaluate(a, [{"total": 50}, {"total": 80}]) is False
    assert alert_service.evaluate(a, [{"other": 999}]) is False  # missing column


async def test_alert_fires_notification(client: AsyncClient, auth: dict):
    sq = (
        await client.post(
            "/api/v1/saved/",
            json={"name": "Satışlar", "nl_query": "satışlar", "schedule": "off"},
            headers=auth,
        )
    ).json()
    alert = await client.post(
        "/api/v1/alerts",
        json={
            "saved_query_id": sq["id"],
            "name": "Gəlir > 0",
            "column": "total",
            "operator": ">",
            "threshold": 0,
        },
        headers=auth,
    )
    assert alert.status_code == 201, alert.text

    # Running the saved query evaluates the alert → notification.
    run = await client.post(f"/api/v1/saved/{sq['id']}/run", headers=auth)
    assert run.status_code == 200, run.text

    notifs = await client.get("/api/v1/notifications", headers=auth)
    assert len(notifs.json()) >= 1
    assert notifs.json()[0]["read"] is False

    # Mark all read.
    assert (await client.post("/api/v1/notifications/read-all", headers=auth)).status_code == 204
    after = await client.get("/api/v1/notifications", headers=auth)
    assert all(n["read"] for n in after.json())
