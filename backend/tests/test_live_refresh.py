"""Live-mode dashboard: toggle endpoint, demo feed, and the refresh tick."""
from __future__ import annotations

import random

from httpx import AsyncClient


def _mock_query_ai(monkeypatch):
    from app.ai.types import ChartConfig, Text2SQLResult
    from app.services import query_service

    async def fake_sql(self, nl, schema, dtype="sqlite", extra_context=""):
        return Text2SQLResult(
            sql="SELECT category, SUM(revenue) AS total FROM sales GROUP BY category",
            explanation="x", confidence=0.9, warnings=[],
        )

    async def fake_chart(columns, data, nl):
        return ChartConfig(chart_type="bar", x_axis="category", y_axis="total")

    async def fake_insight(data, nl, chart_type=""):
        return "Kateqoriya gəliri."

    monkeypatch.setattr(query_service.Text2SQLEngine, "generate_sql", fake_sql)
    monkeypatch.setattr(query_service, "select_chart_type", fake_chart)
    monkeypatch.setattr(query_service, "generate_insight", fake_insight)


async def _make_widget_dashboard(client: AsyncClient, auth: dict) -> tuple[str, str]:
    ask = await client.post(
        "/api/v1/query/ask",
        json={"nl_query": "Kateqoriya üzrə gəlir", "datasource_id": None},
        headers=auth,
    )
    qid = ask.json()["query_log_id"]
    dash_id = (
        await client.post("/api/v1/dashboard/", json={"name": "Live"}, headers=auth)
    ).json()["id"]
    await client.post(
        f"/api/v1/dashboard/{dash_id}/widget",
        json={"query_log_id": qid, "title": "W"},
        headers=auth,
    )
    return dash_id, qid


async def test_toggle_live_mode(client: AsyncClient, auth: dict, monkeypatch):
    _mock_query_ai(monkeypatch)
    dash_id, _ = await _make_widget_dashboard(client, auth)

    on = await client.patch(
        f"/api/v1/dashboard/{dash_id}/live",
        json={"enabled": True, "interval_seconds": 5},
        headers=auth,
    )
    assert on.status_code == 200, on.text
    body = on.json()
    assert body["live_enabled"] is True
    assert body["live_interval_seconds"] == 5

    off = await client.patch(
        f"/api/v1/dashboard/{dash_id}/live", json={"enabled": False}, headers=auth
    )
    assert off.json()["live_enabled"] is False


async def test_live_interval_clamped(client: AsyncClient, auth: dict, monkeypatch):
    _mock_query_ai(monkeypatch)
    dash_id, _ = await _make_widget_dashboard(client, auth)
    # Below the min (3) → 422 validation error.
    resp = await client.patch(
        f"/api/v1/dashboard/{dash_id}/live",
        json={"enabled": True, "interval_seconds": 1},
        headers=auth,
    )
    assert resp.status_code == 422


def test_demo_feed_nudge_stays_in_bounds():
    from app.db import demo_data
    from app.services import demo_feed

    rng = random.Random(7)
    baseline = demo_data.current_live_factors()
    last = baseline
    for _ in range(200):
        last = demo_feed.nudge(rng)
    assert set(last) == set(baseline)
    assert all(0.55 <= v <= 1.75 for v in last.values())
    # Reset so other tests see baseline factors.
    demo_data.set_live_factors({k: 1.0 for k in baseline})


def test_demo_feed_moves_revenue():
    """A nudge must change demo query output so live charts visibly move."""
    from app.db import demo_data
    from app.services import demo_feed

    sql = "SELECT category, SUM(revenue) AS total FROM sales GROUP BY category"
    demo_data.set_live_factors({k: 1.0 for k in demo_data.current_live_factors()})
    _, before = demo_data.execute_demo_sql(sql)
    demo_feed.nudge(random.Random(1))
    _, after = demo_data.execute_demo_sql(sql)
    assert before != after
    demo_data.set_live_factors({k: 1.0 for k in demo_data.current_live_factors()})


async def test_live_tick_refreshes_only_active_enabled(
    client: AsyncClient, auth: dict, monkeypatch
):
    """_tick refreshes a dashboard only when it's live AND has a connection."""
    _mock_query_ai(monkeypatch)
    dash_id, _ = await _make_widget_dashboard(client, auth)
    await client.patch(
        f"/api/v1/dashboard/{dash_id}/live", json={"enabled": True, "interval_seconds": 3},
        headers=auth,
    )

    from app.realtime import live_refresh

    sent: list[tuple[str, dict]] = []

    async def fake_broadcast(room, message, exclude=None):
        sent.append((room, message))

    # No active room yet → nothing broadcast.
    monkeypatch.setattr(live_refresh.hub, "broadcast", fake_broadcast)
    monkeypatch.setattr(live_refresh.hub, "active_rooms", lambda: set())
    await live_refresh._tick()
    assert sent == []

    # Simulate a watcher on this dashboard → one live_update with the widget.
    live_refresh._last_run.clear()
    monkeypatch.setattr(live_refresh.hub, "active_rooms", lambda: {dash_id})
    await live_refresh._tick()
    assert len(sent) == 1
    room, message = sent[0]
    assert room == dash_id
    assert message["type"] == "live_update"
    assert message["widgets"] and message["widgets"][0]["chart"]["data"]
