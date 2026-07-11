"""DataSource API + CSV upload — live SQLite source through the real pipeline."""
from __future__ import annotations

import pytest
import pytest_asyncio
from httpx import AsyncClient

from app.ai.types import ChartConfig, Text2SQLResult
from app.services import datasource_service, query_service
from tests.conftest import seed_internal_datasource, seed_sqlite_file

_SALES_DDL = (
    "CREATE TABLE sales (product TEXT, revenue INTEGER);"
    "INSERT INTO sales VALUES ('Laptop', 900), ('Phone', 500), ('Tablet', 300);"
)


@pytest_asyncio.fixture()
async def sqlite_ds_id(client: AsyncClient, auth: dict) -> str:
    """Seed a queryable SQLite datasource via the trusted internal path.

    Direct sqlite datasource creation over the public API is blocked (it could
    attach the app's own DB / arbitrary local files), so tests mint one the same
    way the upload pipeline does: internal=True, confined to UPLOAD_DIR.
    """
    conn_str = seed_sqlite_file(_SALES_DDL)
    return await seed_internal_datasource("test@nexusbi.io", "Sales", conn_str)


@pytest.fixture(autouse=True)
def _mock_sql(monkeypatch):
    async def fake_sql(self, nl, schema, dtype="sqlite", extra_context=""):
        return Text2SQLResult(sql="SELECT product, revenue FROM sales", confidence=0.9)

    async def fake_chart(columns, data, nl):
        return ChartConfig(chart_type="bar", x_axis="product", y_axis="revenue")

    async def fake_insight(data, nl, chart_type=""):
        return "ok"

    monkeypatch.setattr(query_service.Text2SQLEngine, "generate_sql", fake_sql)
    monkeypatch.setattr(query_service, "select_chart_type", fake_chart)
    monkeypatch.setattr(query_service, "generate_insight", fake_insight)


async def test_create_test_schema_and_query(
    client: AsyncClient, auth: dict, sqlite_ds_id: str
):
    ds_id = sqlite_ds_id

    assert (await client.post(f"/api/v1/datasource/{ds_id}/test", headers=auth)).json()["ok"]

    schema = await client.get(f"/api/v1/datasource/{ds_id}/schema", headers=auth)
    assert "sales" in schema.json()

    # Query the real datasource through the pipeline.
    res = await client.post(
        "/api/v1/query/ask",
        json={"nl_query": "məhsul gəlirləri", "datasource_id": ds_id},
        headers=auth,
    )
    assert res.status_code == 200, res.text
    rows = res.json()["data"]
    assert len(rows) == 3
    assert {r["product"] for r in rows} == {"Laptop", "Phone", "Tablet"}


async def test_direct_sqlite_datasource_is_rejected(client: AsyncClient, auth: dict):
    """A user must not attach a raw sqlite DSN — it could point at the app's own
    DB (every tenant's rows) or an arbitrary local file."""
    conn_str = seed_sqlite_file()
    resp = await client.post(
        "/api/v1/datasource/",
        json={"name": "Evil", "db_type": "sqlite", "connection_string": conn_str},
        headers=auth,
    )
    assert resp.status_code == 502
    # The rejected connection string must never be echoed back.
    assert "test_src_" not in resp.text


async def test_csv_upload_creates_queryable_source(client: AsyncClient, auth: dict):
    csv = b"product,revenue\nLaptop,900\nPhone,500\nTablet,300\n"
    up = await client.post(
        "/api/v1/datasource/upload",
        files={"file": ("sales.csv", csv, "text/csv")},
        data={"name": "Sales CSV"},
        headers=auth,
    )
    assert up.status_code == 201, up.text
    ds_id = up.json()["id"]
    assert up.json()["db_type"] == "sqlite"
    # The DataSourceResponse DTO must never echo the connection string.
    assert "connection" not in up.text.lower()

    schema = await client.get(f"/api/v1/datasource/{ds_id}/schema", headers=auth)
    assert "sales" in schema.json()

    res = await client.post(
        "/api/v1/query/ask",
        json={"nl_query": "gəlirlər", "datasource_id": ds_id},
        headers=auth,
    )
    assert res.status_code == 200, res.text
    assert len(res.json()["data"]) == 3


async def test_upload_rejects_bad_extension(client: AsyncClient, auth: dict):
    bad = await client.post(
        "/api/v1/datasource/upload",
        files={"file": ("notes.txt", b"hello", "text/plain")},
        headers=auth,
    )
    assert bad.status_code == 400


async def test_query_error_surfaces_generated_sql(
    client: AsyncClient, auth: dict, sqlite_ds_id: str, monkeypatch
):
    from app.core.exceptions import DataSourceConnectionError

    async def boom(ds, sql):
        raise DataSourceConnectionError("Sorğu icra olunmadı.", detail="no such column")

    monkeypatch.setattr(datasource_service, "execute_select", boom)

    ds_id = sqlite_ds_id
    res = await client.post(
        "/api/v1/query/ask",
        json={"nl_query": "nəsə", "datasource_id": ds_id},
        headers=auth,
    )
    assert res.status_code == 502
    body = res.json()
    assert body["sql"] == "SELECT product, revenue FROM sales"  # generated SQL surfaced


# ─── Replace-in-place data refresh ───

async def test_replace_data_keeps_id_and_wiring(client: AsyncClient, auth: dict):
    """Refreshing a file source keeps its id, so FK'd queries stay wired, and the
    new rows are visible (old cached result is invalidated)."""
    csv1 = b"product,revenue\nLaptop,900\nPhone,500\nTablet,300\n"
    up = await client.post(
        "/api/v1/datasource/upload",
        files={"file": ("sales.csv", csv1, "text/csv")},
        data={"name": "Sales"},
        headers=auth,
    )
    ds_id = up.json()["id"]

    ask = await client.post(
        "/api/v1/query/ask",
        json={"nl_query": "gəlirlər", "datasource_id": ds_id},
        headers=auth,
    )
    qid = ask.json()["query_log_id"]
    assert len(ask.json()["data"]) == 3

    csv2 = b"product,revenue\nLaptop,900\nPhone,500\nTablet,300\nWatch,150\nMouse,90\n"
    rep = await client.patch(
        f"/api/v1/datasource/{ds_id}/data",
        files={"file": ("sales.csv", csv2, "text/csv")},
        headers=auth,
    )
    assert rep.status_code == 200, rep.text
    body = rep.json()
    assert body["datasource"]["id"] == ds_id  # SAME row — nothing orphaned
    assert body["rows"] == 5
    assert body["warnings"] == []  # same schema → clean swap

    # The FK'd query log still resolves against the (refreshed) source.
    assert (await client.get(f"/api/v1/query/{qid}", headers=auth)).status_code == 200
    # A fresh query now sees the new rows (qcache was invalidated).
    ask2 = await client.post(
        "/api/v1/query/ask",
        json={"nl_query": "gəlirlər", "datasource_id": ds_id},
        headers=auth,
    )
    assert len(ask2.json()["data"]) == 5


async def test_replace_data_warns_on_dropped_column(client: AsyncClient, auth: dict):
    csv1 = b"product,revenue,region\nLaptop,900,North\nPhone,500,South\n"
    up = await client.post(
        "/api/v1/datasource/upload",
        files={"file": ("sales.csv", csv1, "text/csv")},
        data={"name": "S"},
        headers=auth,
    )
    ds_id = up.json()["id"]

    csv2 = b"product,revenue\nLaptop,900\nPhone,500\n"  # 'region' dropped
    rep = await client.patch(
        f"/api/v1/datasource/{ds_id}/data",
        files={"file": ("sales.csv", csv2, "text/csv")},
        headers=auth,
    )
    assert rep.status_code == 200, rep.text
    assert "sales.region" in rep.json()["warnings"]


async def test_replace_data_rejects_unknown_source(client: AsyncClient, auth: dict):
    resp = await client.patch(
        "/api/v1/datasource/does-not-exist/data",
        files={"file": ("x.csv", b"a,b\n1,2\n", "text/csv")},
        headers=auth,
    )
    assert resp.status_code == 404


# ─── One-click Explore (X-ray dashboard) ───

async def test_explore_builds_offline_dashboard(client: AsyncClient, auth: dict):
    """Explore builds a multi-widget dashboard with NO AI (conftest forces an empty
    key) — the flagship offline path the LLM planner can't provide."""
    csv = (
        b"category,region,revenue,quantity,sale_date\n"
        b"Elec,North,900,3,2024-01\n"
        b"Elec,South,500,2,2024-02\n"
        b"Home,North,300,1,2024-01\n"
        b"Home,West,200,5,2024-03\n"
    )
    up = await client.post(
        "/api/v1/datasource/upload",
        files={"file": ("sales.csv", csv, "text/csv")},
        data={"name": "Sales"},
        headers=auth,
    )
    ds_id = up.json()["id"]

    resp = await client.post(f"/api/v1/datasource/{ds_id}/explore", headers=auth)
    assert resp.status_code == 200, resp.text
    dash = resp.json()
    assert dash["id"]
    widgets = dash["widgets"]
    assert len(widgets) >= 3  # KPI totals + breakdowns + count

    charts = [w["chart"] for w in widgets]
    assert all(c is not None and c["data"] for c in charts)  # every widget has real data
    types = {c["chart_type"] for c in charts}
    assert "kpi_card" in types  # SUM totals render as KPI cards

    # The dashboard is persisted and listable.
    listed = await client.get("/api/v1/dashboard/", headers=auth)
    assert any(d["id"] == dash["id"] for d in listed.json())


async def test_explore_rejects_unknown_source(client: AsyncClient, auth: dict):
    resp = await client.post("/api/v1/datasource/does-not-exist/explore", headers=auth)
    assert resp.status_code == 404


def test_explore_composes_dialect_aware_quoting():
    """MySQL needs backtick identifiers — double-quoting there reads as a string
    literal and would break every composed query (sqlite/postgres keep the ANSI \")."""
    from app.services import explore_service as ex

    args = (["revenue"], ["region"], ["sale_date"])
    mysql = ex._compose_queries("sales", *args, "mysql")
    ansi = ex._compose_queries("sales", *args, "postgresql")

    mysql_sql = " ".join(sql for _, sql in mysql)
    ansi_sql = " ".join(sql for _, sql in ansi)

    assert "`sales`" in mysql_sql and "`revenue`" in mysql_sql and "`say`" in mysql_sql
    assert '"' not in mysql_sql  # no ANSI quotes leak into the MySQL SQL
    assert '"sales"' in ansi_sql and '"revenue"' in ansi_sql
    assert "`" not in ansi_sql  # no backticks leak into the ANSI SQL


async def test_metrics_endpoint(client: AsyncClient):
    resp = await client.get("/metrics")
    assert resp.status_code == 200
    assert "nexusbi_http_requests_total" in resp.text
