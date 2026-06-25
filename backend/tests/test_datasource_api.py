"""DataSource API + CSV upload — live SQLite source through the real pipeline."""
from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest
from httpx import AsyncClient

from app.ai.types import ChartConfig, Text2SQLResult
from app.services import query_service


@pytest.fixture()
def sqlite_source(tmp_path: Path) -> str:
    """A real on-disk SQLite DB with one table → returns its async conn string."""
    db = tmp_path / "src.db"
    con = sqlite3.connect(db)
    con.execute("CREATE TABLE sales (product TEXT, revenue INTEGER)")
    con.executemany(
        "INSERT INTO sales VALUES (?, ?)",
        [("Laptop", 900), ("Phone", 500), ("Tablet", 300)],
    )
    con.commit()
    con.close()
    return f"sqlite+aiosqlite:///{db}"


@pytest.fixture(autouse=True)
def _mock_sql(monkeypatch):
    async def fake_sql(self, nl, schema, dtype="sqlite"):
        return Text2SQLResult(sql="SELECT product, revenue FROM sales", confidence=0.9)

    async def fake_chart(columns, data, nl):
        return ChartConfig(chart_type="bar", x_axis="product", y_axis="revenue")

    async def fake_insight(data, nl, chart_type=""):
        return "ok"

    monkeypatch.setattr(query_service.Text2SQLEngine, "generate_sql", fake_sql)
    monkeypatch.setattr(query_service, "select_chart_type", fake_chart)
    monkeypatch.setattr(query_service, "generate_insight", fake_insight)


async def test_create_test_schema_and_query(client: AsyncClient, auth: dict, sqlite_source: str):
    # Create a datasource pointing at the real sqlite file.
    created = await client.post(
        "/api/v1/datasource/",
        json={"name": "Sales", "db_type": "sqlite", "connection_string": sqlite_source},
        headers=auth,
    )
    assert created.status_code == 201, created.text
    ds_id = created.json()["id"]
    # Connection string must never be echoed back.
    assert "connection" not in created.text.lower()

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
