"""Viewer-side filtering of shared/embedded dashboards (unauthenticated)."""
from __future__ import annotations

from httpx import AsyncClient

from app.core import rate_limit as rl


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


async def _shared_dashboard(client: AsyncClient, auth: dict, monkeypatch) -> tuple[str, str]:
    """Create a dashboard with one region-breakdown widget and share it."""
    _mock_query_ai(monkeypatch)
    ask = await client.post(
        "/api/v1/query/ask",
        json={"nl_query": "Region üzrə gəlir", "datasource_id": None},
        headers=auth,
    )
    qid = ask.json()["query_log_id"]
    dash_id = (
        await client.post("/api/v1/dashboard/", json={"name": "PF"}, headers=auth)
    ).json()["id"]
    await client.post(
        f"/api/v1/dashboard/{dash_id}/widget",
        json={"query_log_id": qid, "title": "Region"},
        headers=auth,
    )
    token = (
        await client.post(f"/api/v1/dashboard/{dash_id}/share", headers=auth)
    ).json()["token"]
    return dash_id, token


def _reset_filter_bucket():
    """Tests share one in-process IP bucket — isolate the strict filter limit."""
    rl._HITS.pop("public_filter", None)


async def test_public_filter_applies_and_clears(client: AsyncClient, auth: dict, monkeypatch):
    _reset_filter_bucket()
    dash_id, token = await _shared_dashboard(client, auth, monkeypatch)

    # Anonymous viewer narrows to one region — NO auth headers.
    resp = await client.post(
        f"/api/v1/public/dashboard/{token}/filter",
        json={"dimensions": [{"column": "region", "values": ["North"]}]},
    )
    assert resp.status_code == 200, resp.text
    rows = resp.json()["widgets"][0]["chart"]["data"]
    assert len(rows) == 1 and rows[0]["region"] == "North"

    # NOT persisted: the owner's dashboard still has no global filter.
    owner = await client.get(f"/api/v1/dashboard/{dash_id}", headers=auth)
    assert not owner.json().get("global_filter")

    # Empty spec = clear → stored snapshots (full breakdown) come back.
    cleared = await client.post(f"/api/v1/public/dashboard/{token}/filter", json={})
    assert len(cleared.json()["widgets"][0]["chart"]["data"]) > 1


async def test_public_filter_rejects_hidden_columns(client: AsyncClient, auth: dict, monkeypatch):
    _reset_filter_bucket()
    _, token = await _shared_dashboard(client, auth, monkeypatch)
    # "salary" is not among the dashboard's stored result columns — an anonymous
    # viewer must not be able to slice by columns the dashboard never shows.
    resp = await client.post(
        f"/api/v1/public/dashboard/{token}/filter",
        json={"dimensions": [{"column": "salary", "values": ["1000"]}]},
    )
    assert resp.status_code == 400
    resp = await client.post(
        f"/api/v1/public/dashboard/{token}/filter",
        json={"date_column": "salary", "date_start": "2024-01-01"},
    )
    assert resp.status_code == 400


async def test_public_filter_caps(client: AsyncClient, auth: dict, monkeypatch):
    _reset_filter_bucket()
    _, token = await _shared_dashboard(client, auth, monkeypatch)
    too_many_dims = {"dimensions": [{"column": f"c{i}", "values": ["x"]} for i in range(6)]}
    assert (
        await client.post(f"/api/v1/public/dashboard/{token}/filter", json=too_many_dims)
    ).status_code == 400
    too_many_values = {"dimensions": [{"column": "region", "values": [str(i) for i in range(61)]}]}
    assert (
        await client.post(f"/api/v1/public/dashboard/{token}/filter", json=too_many_values)
    ).status_code == 400
    # Splitting the same column across dimensions must NOT slip past the value cap
    # (the SQL layer coalesces same-column dimensions into one IN-list).
    split = {
        "dimensions": [
            {"column": "region", "values": [str(i) for i in range(40)]},
            {"column": "region", "values": [str(i) for i in range(40, 80)]},
        ]
    }
    assert (
        await client.post(f"/api/v1/public/dashboard/{token}/filter", json=split)
    ).status_code == 400


async def test_public_filter_bad_token_404(client: AsyncClient):
    _reset_filter_bucket()
    resp = await client.post(
        "/api/v1/public/dashboard/no-such-token/filter",
        json={"dimensions": [{"column": "region", "values": ["North"]}]},
    )
    assert resp.status_code == 404


async def test_embed_filter_applies(client: AsyncClient, auth: dict, monkeypatch):
    _reset_filter_bucket()
    dash_id, _ = await _shared_dashboard(client, auth, monkeypatch)
    toggle = await client.patch(
        f"/api/v1/dashboard/{dash_id}/embed", json={"enabled": True}, headers=auth
    )
    embed_token = toggle.json()["token"]
    resp = await client.post(
        f"/api/v1/public/embed/{embed_token}/filter",
        json={"dimensions": [{"column": "region", "values": ["North"]}]},
    )
    assert resp.status_code == 200, resp.text
    rows = resp.json()["widgets"][0]["chart"]["data"]
    assert len(rows) == 1 and rows[0]["region"] == "North"


async def test_public_filter_rate_limited(client: AsyncClient, auth: dict, monkeypatch):
    _reset_filter_bucket()
    _, token = await _shared_dashboard(client, auth, monkeypatch)
    last = None
    for _ in range(11):
        last = await client.post(f"/api/v1/public/dashboard/{token}/filter", json={})
    assert last is not None and last.status_code == 429
    _reset_filter_bucket()  # don't poison later tests in the same process
