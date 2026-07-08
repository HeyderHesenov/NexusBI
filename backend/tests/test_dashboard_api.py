"""Dashboard CRUD API tests."""
from __future__ import annotations

from httpx import AsyncClient


async def test_dashboard_crud(client: AsyncClient, auth: dict):
    # create
    created = await client.post(
        "/api/v1/dashboard/", json={"name": "Sales", "description": "rüblük"}, headers=auth
    )
    assert created.status_code == 201
    dash_id = created.json()["id"]

    # list
    listed = await client.get("/api/v1/dashboard/", headers=auth)
    assert any(d["id"] == dash_id for d in listed.json())

    # update
    updated = await client.put(
        f"/api/v1/dashboard/{dash_id}", json={"name": "Sales 2025"}, headers=auth
    )
    assert updated.json()["name"] == "Sales 2025"

    # delete
    deleted = await client.delete(f"/api/v1/dashboard/{dash_id}", headers=auth)
    assert deleted.status_code == 204


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
        return "Region trendi."

    monkeypatch.setattr(query_service.Text2SQLEngine, "generate_sql", fake_sql)
    monkeypatch.setattr(query_service, "select_chart_type", fake_chart)
    monkeypatch.setattr(query_service, "generate_insight", fake_insight)


async def _make_query(client: AsyncClient, auth: dict) -> str:
    ask = await client.post(
        "/api/v1/query/ask",
        json={"nl_query": "Region üzrə gəlir", "datasource_id": None},
        headers=auth,
    )
    return ask.json()["query_log_id"]


async def test_widget_add_and_remove(client: AsyncClient, auth: dict, monkeypatch):
    _mock_query_ai(monkeypatch)
    qid = await _make_query(client, auth)
    dash_id = (
        await client.post("/api/v1/dashboard/", json={"name": "D"}, headers=auth)
    ).json()["id"]

    widget = await client.post(
        f"/api/v1/dashboard/{dash_id}/widget",
        json={"query_log_id": qid, "title": "W"},
        headers=auth,
    )
    assert widget.status_code == 201
    widget_id = widget.json()["id"]

    detail = await client.get(f"/api/v1/dashboard/{dash_id}", headers=auth)
    assert len(detail.json()["widgets"]) == 1

    removed = await client.delete(
        f"/api/v1/dashboard/{dash_id}/widget/{widget_id}", headers=auth
    )
    assert removed.status_code == 204


async def test_widget_rejects_unowned_query_log(client: AsyncClient, auth: dict):
    # A widget cannot attach a query_log that isn't the caller's (IDOR guard).
    dash_id = (
        await client.post("/api/v1/dashboard/", json={"name": "D"}, headers=auth)
    ).json()["id"]
    resp = await client.post(
        f"/api/v1/dashboard/{dash_id}/widget",
        json={"query_log_id": "00000000-0000-0000-0000-000000000000", "title": "W"},
        headers=auth,
    )
    assert resp.status_code == 404


async def test_widget_embeds_query_snapshot(client: AsyncClient, auth: dict, monkeypatch):
    _mock_query_ai(monkeypatch)
    qid = await _make_query(client, auth)
    dash_id = (
        await client.post("/api/v1/dashboard/", json={"name": "Sales"}, headers=auth)
    ).json()["id"]
    added = await client.post(
        f"/api/v1/dashboard/{dash_id}/widget",
        json={"query_log_id": qid, "title": "Region"},
        headers=auth,
    )
    chart = added.json()["chart"]
    assert chart is not None
    assert chart["chart_type"] == "bar"
    assert chart["columns"] and chart["data"]
    assert chart["insight"] == "Region trendi."


async def test_widget_refresh_reruns_and_repoints(client: AsyncClient, auth: dict, monkeypatch):
    _mock_query_ai(monkeypatch)
    qid = await _make_query(client, auth)
    dash_id = (
        await client.post("/api/v1/dashboard/", json={"name": "D"}, headers=auth)
    ).json()["id"]
    widget = (
        await client.post(
            f"/api/v1/dashboard/{dash_id}/widget",
            json={"query_log_id": qid, "title": "W"},
            headers=auth,
        )
    ).json()
    wid = widget["id"]

    refreshed = await client.post(
        f"/api/v1/dashboard/{dash_id}/widget/{wid}/refresh", headers=auth
    )
    assert refreshed.status_code == 200, refreshed.text
    body = refreshed.json()
    # A refresh re-runs the query → a NEW query_log is linked, fresh chart returned.
    assert body["query_log_id"] != qid
    assert body["chart"]["data"]
    assert body["chart"]["datasource_name"] == "Demo"


async def test_refresh_all_widgets(client: AsyncClient, auth: dict, monkeypatch):
    _mock_query_ai(monkeypatch)
    qid = await _make_query(client, auth)
    dash_id = (
        await client.post("/api/v1/dashboard/", json={"name": "D"}, headers=auth)
    ).json()["id"]
    await client.post(
        f"/api/v1/dashboard/{dash_id}/widget",
        json={"query_log_id": qid, "title": "W"},
        headers=auth,
    )
    resp = await client.post(f"/api/v1/dashboard/{dash_id}/refresh-all", headers=auth)
    assert resp.status_code == 200, resp.text
    assert len(resp.json()["widgets"]) == 1


async def test_global_filter_applies_persists_and_clears(
    client: AsyncClient, auth: dict, monkeypatch
):
    _mock_query_ai(monkeypatch)
    qid = await _make_query(client, auth)
    dash_id = (
        await client.post("/api/v1/dashboard/", json={"name": "D"}, headers=auth)
    ).json()["id"]
    await client.post(
        f"/api/v1/dashboard/{dash_id}/widget",
        json={"query_log_id": qid, "title": "Region"},
        headers=auth,
    )

    # Baseline: the region breakdown returns several rows.
    base = await client.get(f"/api/v1/dashboard/{dash_id}", headers=auth)
    assert len(base.json()["widgets"][0]["chart"]["data"]) > 1

    # Apply a dimension filter → only the North row survives (aggregate re-run).
    resp = await client.patch(
        f"/api/v1/dashboard/{dash_id}/filter",
        json={"dimensions": [{"column": "region", "values": ["North"]}]},
        headers=auth,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["global_filter"]["dimensions"][0]["values"] == ["North"]
    rows = body["widgets"][0]["chart"]["data"]
    assert len(rows) == 1 and rows[0]["region"] == "North"

    # Persisted: reopening the dashboard carries the filter selection.
    reopened = await client.get(f"/api/v1/dashboard/{dash_id}", headers=auth)
    assert reopened.json()["global_filter"]["dimensions"][0]["values"] == ["North"]

    # Clear (empty spec) → widgets return to the full, unfiltered breakdown.
    cleared = await client.patch(f"/api/v1/dashboard/{dash_id}/filter", json={}, headers=auth)
    assert len(cleared.json()["widgets"][0]["chart"]["data"]) > 1


async def test_global_filter_requires_ownership(client: AsyncClient, auth: dict):
    resp = await client.patch(
        "/api/v1/dashboard/00000000-0000-0000-0000-000000000000/filter",
        json={"dimensions": [{"column": "region", "values": ["North"]}]},
        headers=auth,
    )
    assert resp.status_code == 404


async def test_dashboard_requires_auth(client: AsyncClient):
    resp = await client.get("/api/v1/dashboard/")
    assert resp.status_code == 401
