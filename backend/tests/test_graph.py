"""Knowledge graph — lineage edges, hierarchy edges, dedupe, user isolation."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from httpx import AsyncClient
from sqlalchemy import select

from app.ai.types import ChartConfig, Text2SQLResult
from app.models.datasource import DataSource
from app.services import graph_service, query_service

from tests.conftest import seed_internal_datasource, seed_sqlite_file


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


# --- Trust & health overlay ------------------------------------------------


def test_metric_status_helper():
    assert graph_service._metric_status(SimpleNamespace(verified=True)) == ("ok", "verified")
    assert graph_service._metric_status(SimpleNamespace(verified=False)) == ("warn", "unverified")


def test_ds_status_helper():
    now = datetime(2026, 7, 15, 12, 0, tzinfo=timezone.utc)
    fresh = SimpleNamespace(freshness_sla_hours=24, last_refreshed_at=now - timedelta(hours=1))
    stale = SimpleNamespace(freshness_sla_hours=24, last_refreshed_at=now - timedelta(hours=48))
    no_sla = SimpleNamespace(freshness_sla_hours=None, last_refreshed_at=now)
    never = SimpleNamespace(freshness_sla_hours=24, last_refreshed_at=None)
    assert graph_service._ds_status(fresh, now) == ("ok", "fresh")
    assert graph_service._ds_status(stale, now) == ("danger", "stale")
    assert graph_service._ds_status(no_sla, now) == ("unknown", "unknown")
    assert graph_service._ds_status(never, now) == ("unknown", "unknown")


async def test_graph_metric_health(client: AsyncClient, auth: dict, monkeypatch):
    await _seed_assets(client, auth, monkeypatch)  # creates metric "gəlir"
    await client.post("/api/v1/metrics/", json={"name": "profit", "synonyms": ""}, headers=auth)
    metrics = (await client.get("/api/v1/metrics/", headers=auth)).json()
    gelir = next(m for m in metrics if m["name"] == "gəlir")
    profit = next(m for m in metrics if m["name"] == "profit")
    await client.patch(
        f"/api/v1/metrics/{gelir['id']}/verify", json={"verified": True}, headers=auth
    )

    by_id = {n["id"]: n for n in (await client.get("/api/v1/graph/", headers=auth)).json()["nodes"]}
    assert by_id[f"metric:{gelir['id']}"]["status"] == "ok"
    assert by_id[f"metric:{gelir['id']}"]["reason"] == "verified"
    assert by_id[f"metric:{profit['id']}"]["status"] == "warn"
    assert by_id[f"metric:{profit['id']}"]["reason"] == "unverified"


async def test_graph_ds_freshness(client: AsyncClient, auth: dict):
    conn = seed_sqlite_file("CREATE TABLE t (x INTEGER)")
    ds_id = await seed_internal_datasource("test@nexusbi.io", "Warehouse", conn)
    # Freshly seeded → last_refreshed_at ≈ now; an SLA of 24h makes it fresh.
    await client.patch(
        f"/api/v1/datasource/{ds_id}/sla", json={"freshness_sla_hours": 24}, headers=auth
    )
    by_id = {n["id"]: n for n in (await client.get("/api/v1/graph/", headers=auth)).json()["nodes"]}
    node = by_id[f"ds:{ds_id}"]
    assert node["status"] == "ok"
    assert node["reason"] == "fresh"


async def test_graph_status_optional(client: AsyncClient, auth: dict, monkeypatch):
    """Nodes without a health notion (table/widget/demo ds) carry a null status."""
    assets = await _seed_assets(client, auth, monkeypatch)
    by_id = {n["id"]: n for n in (await client.get("/api/v1/graph/", headers=auth)).json()["nodes"]}
    assert by_id["table:sales"]["status"] is None
    assert by_id[f"widget:{assets['widget']['id']}"]["status"] is None
    assert by_id["ds:demo"]["status"] is None


# --- Schema accuracy: FK + column lineage ----------------------------------


def test_link_fk_edges_helper():
    g = graph_service._GraphBuilder()
    g.node("table:orders", "table", "orders")
    g.node("table:customers", "table", "customers")
    ds = SimpleNamespace(
        schema_cache={
            "orders": [
                {"name": "id", "type": "INTEGER"},
                {"name": "customer_id", "type": "INTEGER", "references": "customers.id"},
                # products has no graph node → must NOT produce an edge.
                {"name": "product_id", "type": "INTEGER", "references": "products.id"},
            ],
            "customers": [{"name": "id", "type": "INTEGER"}],
        }
    )
    graph_service._link_fk_edges(g, [ds])
    assert ("table:orders", "table:customers", "references") in g.edges
    assert not any(t == "table:products" for _, t, _ in g.edges)
    # A source with no cached schema must be a no-op, not a crash.
    graph_service._link_fk_edges(g, [SimpleNamespace(schema_cache=None)])


async def test_graph_fk_edges(client: AsyncClient, auth: dict, db_session, monkeypatch):
    conn = seed_sqlite_file(
        "CREATE TABLE customers (id INTEGER);"
        "CREATE TABLE orders (id INTEGER, customer_id INTEGER);"
        "INSERT INTO customers VALUES (1);"
        "INSERT INTO orders VALUES (1, 1);"
    )
    ds_id = await seed_internal_datasource("test@nexusbi.io", "Shop", conn)
    ds = (
        await db_session.execute(select(DataSource).where(DataSource.id == ds_id))
    ).scalar_one()
    ds.schema_cache = {
        "orders": [
            {"name": "id", "type": "INTEGER"},
            {"name": "customer_id", "type": "INTEGER", "references": "customers.id"},
        ],
        "customers": [{"name": "id", "type": "INTEGER"}],
    }
    await db_session.commit()

    _mock_query_ai(monkeypatch)

    async def orders_sql(self, nl, schema, dtype="sqlite", extra_context=""):
        return Text2SQLResult(
            sql="SELECT o.id AS oid FROM orders o JOIN customers c ON o.customer_id = c.id",
            explanation="x", confidence=0.9, warnings=[],
        )

    monkeypatch.setattr(query_service.Text2SQLEngine, "generate_sql", orders_sql)
    dash = (
        await client.post("/api/v1/dashboard/", json={"name": "P", "description": ""}, headers=auth)
    ).json()
    ask = await client.post(
        "/api/v1/query/ask", json={"nl_query": "orders", "datasource_id": ds_id}, headers=auth
    )
    await client.post(
        f"/api/v1/dashboard/{dash['id']}/widget",
        json={"query_log_id": ask.json()["query_log_id"], "title": "O"},
        headers=auth,
    )

    body = (await client.get("/api/v1/graph/", headers=auth)).json()
    node_ids = {n["id"] for n in body["nodes"]}
    edges = {(e["source"], e["target"], e["kind"]) for e in body["edges"]}
    assert {"table:orders", "table:customers"} <= node_ids
    assert ("table:orders", "table:customers", "references") in edges


async def test_graph_columns_off_by_default(client: AsyncClient, auth: dict, monkeypatch):
    await _seed_assets(client, auth, monkeypatch)
    body = (await client.get("/api/v1/graph/", headers=auth)).json()
    assert not any(n["id"].startswith("column:") for n in body["nodes"])


async def test_graph_columns_param(client: AsyncClient, auth: dict, monkeypatch):
    assets = await _seed_assets(client, auth, monkeypatch)
    wid = assets["widget"]["id"]
    body = (await client.get("/api/v1/graph/?columns=true", headers=auth)).json()
    node_ids = {n["id"] for n in body["nodes"]}
    edges = {(e["source"], e["target"], e["kind"]) for e in body["edges"]}
    # Demo query "SELECT region, SUM(revenue) AS total FROM sales" → region/total columns.
    assert "column:sales.region" in node_ids
    assert ("table:sales", "column:sales.region", "has_column") in edges
    assert ("column:sales.region", f"widget:{wid}", "feeds") in edges


# --- Saved graph views (user-curated overlays) -----------------------------


async def test_graph_view_crud(client: AsyncClient, auth: dict):
    # Create with an included subset.
    created = await client.post(
        "/api/v1/graph/views",
        json={"name": "My view", "included_node_ids": ["ds:demo", "table:sales"]},
        headers=auth,
    )
    assert created.status_code == 201, created.text
    view = created.json()
    assert view["name"] == "My view"
    assert view["included_node_ids"] == ["ds:demo", "table:sales"]
    assert view["hidden_node_ids"] == []
    vid = view["id"]

    # List reflects it.
    listing = (await client.get("/api/v1/graph/views", headers=auth)).json()
    assert [v["id"] for v in listing] == [vid]

    # PATCH a single field (hide a node); updated_at moves forward.
    patched = await client.patch(
        f"/api/v1/graph/views/{vid}",
        json={"hidden_node_ids": ["table:sales"], "name": "Renamed"},
        headers=auth,
    )
    assert patched.status_code == 200, patched.text
    body = patched.json()
    assert body["hidden_node_ids"] == ["table:sales"]
    assert body["name"] == "Renamed"
    assert body["included_node_ids"] == ["ds:demo", "table:sales"]  # untouched
    assert body["updated_at"] >= view["updated_at"]

    # Delete → gone.
    assert (await client.delete(f"/api/v1/graph/views/{vid}", headers=auth)).status_code == 204
    assert (await client.get("/api/v1/graph/views", headers=auth)).json() == []


async def test_graph_view_full_base(client: AsyncClient, auth: dict):
    """included_node_ids=None persists null (full-graph base); a list persists verbatim."""
    full = await client.post(
        "/api/v1/graph/views", json={"name": "Full-based"}, headers=auth
    )
    assert full.json()["included_node_ids"] is None

    subset = await client.post(
        "/api/v1/graph/views",
        json={"name": "Subset", "included_node_ids": ["metric:x", "ds:demo"]},
        headers=auth,
    )
    assert subset.json()["included_node_ids"] == ["metric:x", "ds:demo"]


async def test_graph_view_user_isolation(client: AsyncClient, auth: dict):
    created = await client.post(
        "/api/v1/graph/views", json={"name": "A only"}, headers=auth
    )
    vid = created.json()["id"]

    await client.post(
        "/api/v1/auth/register",
        json={"email": "gvother@nexusbi.io", "password": "parol1234", "full_name": "O"},
    )
    login = await client.post(
        "/api/v1/auth/login", json={"email": "gvother@nexusbi.io", "password": "parol1234"}
    )
    other = {"Authorization": f"Bearer {login.json()['access_token']}"}

    # B sees none of A's views, and cannot touch A's view id.
    assert (await client.get("/api/v1/graph/views", headers=other)).json() == []
    assert (
        await client.patch(f"/api/v1/graph/views/{vid}", json={"name": "hijack"}, headers=other)
    ).status_code == 404
    assert (await client.delete(f"/api/v1/graph/views/{vid}", headers=other)).status_code == 404


async def test_graph_views_require_auth(client: AsyncClient):
    assert (await client.get("/api/v1/graph/views")).status_code == 401
    assert (await client.post("/api/v1/graph/views", json={"name": "x"})).status_code == 401
    assert (await client.patch("/api/v1/graph/views/x", json={"name": "y"})).status_code == 401
    assert (await client.delete("/api/v1/graph/views/x")).status_code == 401
