"""Dashboard time machine — capture, retention cap, ownership, scheduler phase."""
from __future__ import annotations

from httpx import AsyncClient

from app.ai.types import ChartConfig, Text2SQLResult
from app.services import query_service, snapshot_service


def _mock_query_ai(monkeypatch):
    async def fake_sql(self, nl, schema, dtype="sqlite", extra_context=""):
        return Text2SQLResult(
            sql="SELECT region, SUM(revenue) AS total FROM sales GROUP BY region",
            explanation="x", confidence=0.9, warnings=[],
        )

    async def fake_chart(columns, data, nl):
        return ChartConfig(chart_type="bar", x_axis="region", y_axis="total")

    async def fake_insight(data, nl, chart_type=""):
        return "Region trendi."

    monkeypatch.setattr(query_service.Text2SQLEngine, "generate_sql", fake_sql)
    monkeypatch.setattr(query_service, "select_chart_type", fake_chart)
    monkeypatch.setattr(query_service, "generate_insight", fake_insight)


async def _dashboard_with_widget(client: AsyncClient, auth: dict, monkeypatch) -> str:
    _mock_query_ai(monkeypatch)
    created = await client.post(
        "/api/v1/dashboard/", json={"name": "Zaman", "description": ""}, headers=auth
    )
    dash_id = created.json()["id"]
    ask = await client.post(
        "/api/v1/query/ask",
        json={"nl_query": "Region üzrə gəlir", "datasource_id": None},
        headers=auth,
    )
    qid = ask.json()["query_log_id"]
    added = await client.post(
        f"/api/v1/dashboard/{dash_id}/widget",
        json={"query_log_id": qid, "title": "Region gəliri"},
        headers=auth,
    )
    assert added.status_code in (200, 201), added.text
    return dash_id


async def test_capture_persists_widget_payload(client: AsyncClient, auth: dict, monkeypatch):
    dash_id = await _dashboard_with_widget(client, auth, monkeypatch)

    created = await client.post(
        f"/api/v1/dashboard/{dash_id}/snapshots", json={"label": "İlkin hal"}, headers=auth
    )
    assert created.status_code == 201, created.text
    meta = created.json()
    assert meta["label"] == "İlkin hal"
    assert meta["origin"] == "manual"
    assert "payload" not in meta  # meta stays light — no widget data

    full = await client.get(
        f"/api/v1/dashboard/{dash_id}/snapshots/{meta['id']}", headers=auth
    )
    body = full.json()
    assert len(body["widgets"]) == 1
    w = body["widgets"][0]
    assert w["chart_type"] == "bar"
    assert "region" in w["columns"]
    assert w["rows"], "snapshot must carry the stored result rows"


async def test_snapshot_row_cap(client: AsyncClient, auth: dict, monkeypatch):
    monkeypatch.setattr(snapshot_service, "MAX_ROWS_PER_WIDGET", 3)
    dash_id = await _dashboard_with_widget(client, auth, monkeypatch)
    created = await client.post(
        f"/api/v1/dashboard/{dash_id}/snapshots", json={}, headers=auth
    )
    sid = created.json()["id"]
    full = await client.get(f"/api/v1/dashboard/{dash_id}/snapshots/{sid}", headers=auth)
    assert len(full.json()["widgets"][0]["rows"]) <= 3


async def test_retention_cap_prunes_oldest(client: AsyncClient, auth: dict, monkeypatch):
    monkeypatch.setattr(snapshot_service, "MAX_SNAPSHOTS_PER_DASHBOARD", 5)
    dash_id = await _dashboard_with_widget(client, auth, monkeypatch)

    ids = []
    for i in range(7):
        r = await client.post(
            f"/api/v1/dashboard/{dash_id}/snapshots", json={"label": f"s{i}"}, headers=auth
        )
        ids.append(r.json()["id"])

    listed = (await client.get(f"/api/v1/dashboard/{dash_id}/snapshots", headers=auth)).json()
    assert len(listed) == 5
    kept = {s["id"] for s in listed}
    assert ids[0] not in kept and ids[1] not in kept  # oldest two pruned
    assert ids[-1] in kept


async def test_scheduled_prune_spares_manual_bookmarks(
    client: AsyncClient, auth: dict, monkeypatch
):
    """Hourly scheduled captures must never evict a user's manual snapshots."""
    from app.db.session import AsyncSessionLocal

    monkeypatch.setattr(snapshot_service, "MAX_SNAPSHOTS_PER_DASHBOARD", 2)
    dash_id = await _dashboard_with_widget(client, auth, monkeypatch)

    manual = await client.post(
        f"/api/v1/dashboard/{dash_id}/snapshots", json={"label": "vacib baza"}, headers=auth
    )
    manual_id = manual.json()["id"]

    async with AsyncSessionLocal() as db:
        from sqlalchemy import select

        from app.models.dashboard import Dashboard

        dash = (await db.execute(select(Dashboard).where(Dashboard.id == dash_id))).scalar_one()
        for _ in range(4):  # over the per-origin cap
            await snapshot_service.capture(db, dash.user_id, dash_id, origin="scheduled")

    listed = (await client.get(f"/api/v1/dashboard/{dash_id}/snapshots", headers=auth)).json()
    kept = {s["id"] for s in listed}
    assert manual_id in kept  # the manual bookmark survived
    assert sum(1 for s in listed if s["origin"] == "scheduled") == 2  # scheduled capped


async def test_snapshot_ownership(client: AsyncClient, auth: dict, monkeypatch):
    dash_id = await _dashboard_with_widget(client, auth, monkeypatch)
    snap = await client.post(f"/api/v1/dashboard/{dash_id}/snapshots", json={}, headers=auth)
    sid = snap.json()["id"]

    # A second user must not see the dashboard's snapshots.
    await client.post(
        "/api/v1/auth/register",
        json={"email": "intruder@nexusbi.io", "password": "parol1234", "full_name": "X"},
    )
    login = await client.post(
        "/api/v1/auth/login", json={"email": "intruder@nexusbi.io", "password": "parol1234"}
    )
    other = {"Authorization": f"Bearer {login.json()['access_token']}"}
    assert (
        await client.get(f"/api/v1/dashboard/{dash_id}/snapshots", headers=other)
    ).status_code == 404
    assert (
        await client.get(f"/api/v1/dashboard/{dash_id}/snapshots/{sid}", headers=other)
    ).status_code == 404
    assert (
        await client.delete(f"/api/v1/dashboard/{dash_id}/snapshots/{sid}", headers=other)
    ).status_code == 404


async def test_snapshot_delete(client: AsyncClient, auth: dict, monkeypatch):
    dash_id = await _dashboard_with_widget(client, auth, monkeypatch)
    snap = await client.post(f"/api/v1/dashboard/{dash_id}/snapshots", json={}, headers=auth)
    sid = snap.json()["id"]
    assert (
        await client.delete(f"/api/v1/dashboard/{dash_id}/snapshots/{sid}", headers=auth)
    ).status_code == 204
    assert (
        await client.get(f"/api/v1/dashboard/{dash_id}/snapshots/{sid}", headers=auth)
    ).status_code == 404


async def test_scheduled_captures_only_live_and_hourly(
    client: AsyncClient, auth: dict, monkeypatch
):
    from app.db.session import AsyncSessionLocal

    dash_id = await _dashboard_with_widget(client, auth, monkeypatch)

    async with AsyncSessionLocal() as db:
        assert await snapshot_service.run_scheduled_captures(db) == 0  # not live

    toggled = await client.patch(
        f"/api/v1/dashboard/{dash_id}/live",
        json={"enabled": True, "interval_seconds": 8},
        headers=auth,
    )
    assert toggled.status_code == 200, toggled.text

    async with AsyncSessionLocal() as db:
        assert await snapshot_service.run_scheduled_captures(db) == 1
        # Second pass inside the hour window is a no-op.
        assert await snapshot_service.run_scheduled_captures(db) == 0

    listed = (await client.get(f"/api/v1/dashboard/{dash_id}/snapshots", headers=auth)).json()
    assert any(s["origin"] == "scheduled" for s in listed)
