"""Knowledge graph — lineage edges, hierarchy edges, dedupe, user isolation."""
from __future__ import annotations

from httpx import AsyncClient

from app.ai.types import ChartConfig, Text2SQLResult
from app.services import query_service


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


async def _seed_assets(client: AsyncClient, auth: dict, monkeypatch) -> dict:
    """dashboard + widget (sales query), a metric matching 'gəlir', a KPI tree."""
    _mock_query_ai(monkeypatch)
    dash = (
        await client.post("/api/v1/dashboard/", json={"name": "Panel", "description": ""}, headers=auth)
    ).json()
    ask = await client.post(
        "/api/v1/query/ask",
        json={"nl_query": "Region üzrə gəlir", "datasource_id": None},
        headers=auth,
    )
    qid = ask.json()["query_log_id"]
    widget = (
        await client.post(
            f"/api/v1/dashboard/{dash['id']}/widget",
            json={"query_log_id": qid, "title": "Region gəliri"},
            headers=auth,
        )
    ).json()
    await client.post(
        "/api/v1/metrics/",
        json={"name": "gəlir", "definition": "SUM(revenue)", "synonyms": "revenue"},
        headers=auth,
    )
    root = (
        await client.post("/api/v1/metric-tree/", json={"name": "Gəlir", "operator": "add"}, headers=auth)
    ).json()
    child = (
        await client.post(
            "/api/v1/metric-tree/",
            json={"name": "Şimal", "parent_id": root["id"], "manual_value": 10},
            headers=auth,
        )
    ).json()
    return {"dash": dash, "widget": widget, "root": root, "child": child}


async def test_graph_composes_lineage_and_hierarchy(client: AsyncClient, auth: dict, monkeypatch):
    assets = await _seed_assets(client, auth, monkeypatch)

    r = await client.get("/api/v1/graph/", headers=auth)
    assert r.status_code == 200, r.text
    body = r.json()
    node_ids = {n["id"] for n in body["nodes"]}
    edges = {(e["source"], e["target"], e["kind"]) for e in body["edges"]}

    wid = assets["widget"]["id"]
    # Lineage: demo ds → sales table → widget → dashboard.
    assert "table:sales" in node_ids
    assert ("ds:demo", "table:sales", "hosts") in edges
    assert ("table:sales", f"widget:{wid}", "feeds") in edges
    assert (f"widget:{wid}", f"dash:{assets['dash']['id']}", "contains") in edges
    # Metric 'gəlir' matches the NL question → informs the widget.
    metric_edges = [e for e in edges if e[0].startswith("metric:") and e[1] == f"widget:{wid}"]
    assert metric_edges, "metric should inform the widget via name match"
    # KPI tree: child rolls up to parent.
    assert (
        f"mnode:{assets['child']['id']}", f"mnode:{assets['root']['id']}", "rolls_up"
    ) in edges


async def test_graph_nodes_deduped(client: AsyncClient, auth: dict, monkeypatch):
    """Two widgets over the same table yield ONE table node."""
    assets = await _seed_assets(client, auth, monkeypatch)
    ask = await client.post(
        "/api/v1/query/ask",
        json={"nl_query": "Kateqoriya üzrə gəlir", "datasource_id": None},
        headers=auth,
    )
    await client.post(
        f"/api/v1/dashboard/{assets['dash']['id']}/widget",
        json={"query_log_id": ask.json()["query_log_id"], "title": "Kateqoriya"},
        headers=auth,
    )
    body = (await client.get("/api/v1/graph/", headers=auth)).json()
    assert sum(1 for n in body["nodes"] if n["id"] == "table:sales") == 1


async def test_graph_user_isolation(client: AsyncClient, auth: dict, monkeypatch):
    await _seed_assets(client, auth, monkeypatch)
    await client.post(
        "/api/v1/auth/register",
        json={"email": "graphother@nexusbi.io", "password": "parol1234", "full_name": "O"},
    )
    login = await client.post(
        "/api/v1/auth/login", json={"email": "graphother@nexusbi.io", "password": "parol1234"}
    )
    other = {"Authorization": f"Bearer {login.json()['access_token']}"}
    body = (await client.get("/api/v1/graph/", headers=other)).json()
    # Fresh user sees only the synthetic demo datasource node — nothing leaks.
    assert {n["type"] for n in body["nodes"]} <= {"ds"}
    assert body["edges"] == []


async def test_graph_requires_auth(client: AsyncClient):
    assert (await client.get("/api/v1/graph/")).status_code == 401
