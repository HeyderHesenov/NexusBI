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


async def test_metrics_endpoint(client: AsyncClient):
    resp = await client.get("/metrics")
    assert resp.status_code == 200
    assert "nexusbi_http_requests_total" in resp.text
