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

    a = Alert(column="total", operator=">", threshold=100, condition_type="static")
    assert alert_service.evaluate(a, [{"total": 50}, {"total": 200}]) is True
    assert alert_service.evaluate(a, [{"total": 50}, {"total": 80}]) is False
    assert alert_service.evaluate(a, [{"other": 999}]) is False  # missing column


def test_evaluate_anomaly_fires_on_outlier_last_point():
    from app.models.alert import Alert
    from app.services import alert_service

    a = Alert(column="total", condition_type="anomaly")
    # Stable series that ENDS in a spike → fires.
    spike = [{"total": v} for v in [100, 102, 98, 101, 99, 103, 500]]
    assert alert_service.evaluate(a, spike) is True
    # Same values but the spike is NOT the last point → does not fire (latest is normal).
    mid = [{"total": v} for v in [100, 500, 98, 101, 99, 103, 100]]
    assert alert_service.evaluate(a, mid) is False
    # Smooth series → no anomaly.
    smooth = [{"total": v} for v in [100, 101, 102, 103, 104, 105]]
    assert alert_service.evaluate(a, smooth) is False
    # Too few points → never fires.
    assert alert_service.evaluate(a, [{"total": 1}, {"total": 999}]) is False


def test_evaluate_anomaly_orders_by_the_time_column():
    """"Latest point" must mean latest in TIME, not last in the engine's row order."""
    from app.models.alert import Alert
    from app.services import alert_service

    a = Alert(column="total", condition_type="anomaly")
    days = [f"2026-01-{d:02d}" for d in range(1, 8)]
    values = [100, 102, 98, 101, 99, 103, 500]  # the spike is on the LAST day
    chrono = [{"day": d, "total": v} for d, v in zip(days, values)]

    assert alert_service.evaluate(a, chrono) is True
    # Same data, reverse order -- an ORDER BY-less SELECT is free to return this.
    assert alert_service.evaluate(a, list(reversed(chrono))) is True
    # And the spike genuinely in the middle of the timeline still must not fire,
    # whichever order the rows arrive in.
    mid = [{"day": d, "total": v} for d, v in zip(days, [100, 500, 98, 101, 99, 103, 100])]
    assert alert_service.evaluate(a, mid) is False
    assert alert_service.evaluate(a, list(reversed(mid))) is False


def test_evaluate_anomaly_survives_a_mixed_type_time_column():
    """sorted() on datetime-vs-str would raise and take the whole tick with it."""
    from datetime import date, datetime, timezone

    from app.models.alert import Alert
    from app.services import alert_service

    a = Alert(column="total", condition_type="anomaly")
    mixed = [
        {"created_at": datetime(2026, 1, 1, tzinfo=timezone.utc), "total": 100},
        {"created_at": datetime(2026, 1, 2), "total": 102},  # naive: the SQLite shape
        {"created_at": date(2026, 1, 3), "total": 98},
        {"created_at": "2026-01-04", "total": 101},
        {"created_at": None, "total": 99},  # unusable key -> dropped, not sorted last
        {"created_at": "2026-01-06", "total": 500},
    ]
    assert alert_service.evaluate(a, mixed) is True

    # A numeric time axis orders numerically, not lexicographically: 9 < 10.
    years = [{"year": y, "total": v} for y, v in zip([7, 8, 9, 10, 11], [100, 101, 99, 102, 500])]
    assert alert_service.evaluate(a, list(reversed(years))) is True

    # An all-NULL time column keeps the engine's order rather than emptying the
    # series -- otherwise alerts that fire today would go silent.
    empty_axis = [{"created_at": None, "total": v} for v in [100, 102, 98, 101, 99, 103, 500]]
    assert alert_service.evaluate(a, empty_axis) is True


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
    # A breached threshold alert is categorized as a KPI alert (not inferred from title).
    fired = next(n for n in notifs.json() if n["title"].startswith("Alert:"))
    assert fired["category"] == "kpi_alert"

    # Mark all read.
    assert (await client.post("/api/v1/notifications/read-all", headers=auth)).status_code == 204
    after = await client.get("/api/v1/notifications", headers=auth)
    assert all(n["read"] for n in after.json())
