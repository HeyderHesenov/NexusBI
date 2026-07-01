"""SQL power-user path — /query/run executes analyst SQL with no AI, full guards."""
from __future__ import annotations

import pytest
from httpx import AsyncClient

pytestmark = pytest.mark.asyncio


async def test_run_valid_select(client: AsyncClient, auth: dict):
    resp = await client.post(
        "/api/v1/query/run",
        json={
            "sql": "SELECT region, SUM(revenue) AS total FROM sales "
            "GROUP BY region ORDER BY total DESC",
            "datasource_id": None,
        },
        headers=auth,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["query_log_id"]
    assert body["columns"]
    assert body["insight"] == ""  # power-user path is AI-free — no narrative
    assert body["chart_config"]["chart_type"]  # rule-based, deterministic


async def test_run_labels_history_with_marker(client: AsyncClient, auth: dict):
    await client.post(
        "/api/v1/query/run",
        json={"sql": "SELECT * FROM products", "label": "stok baxışı", "datasource_id": None},
        headers=auth,
    )
    hist = await client.get("/api/v1/query/history", headers=auth)
    titles = [it["natural_language"] for it in hist.json()["items"]]
    assert any(t.startswith("✎ ") and "stok baxışı" in t for t in titles)


async def test_run_falls_back_to_sql_first_line_label(client: AsyncClient, auth: dict):
    await client.post(
        "/api/v1/query/run",
        json={"sql": "SELECT category FROM products", "datasource_id": None},
        headers=auth,
    )
    hist = await client.get("/api/v1/query/history", headers=auth)
    titles = [it["natural_language"] for it in hist.json()["items"]]
    assert any(t.startswith("✎ SELECT category") for t in titles)


@pytest.mark.parametrize(
    "bad_sql",
    [
        "DELETE FROM sales",
        "DROP TABLE sales",
        "UPDATE sales SET revenue = 0",
        "SELECT 1; SELECT 2",  # multi-statement
        "SELECT * FROM sales; DROP TABLE sales",
        "PRAGMA table_info(sales)",
        "SELECT * FROM sqlite_master",  # metadata exfil
        "SELECT * FROM information_schema.tables",
    ],
)
async def test_run_rejects_dangerous_sql(client: AsyncClient, auth: dict, bad_sql: str):
    resp = await client.post(
        "/api/v1/query/run",
        json={"sql": bad_sql, "datasource_id": None},
        headers=auth,
    )
    assert resp.status_code == 400, f"{bad_sql!r} → {resp.status_code}: {resp.text}"


async def test_run_rejects_table_outside_schema(client: AsyncClient, auth: dict):
    resp = await client.post(
        "/api/v1/query/run",
        json={"sql": "SELECT * FROM secret_table", "datasource_id": None},
        headers=auth,
    )
    assert resp.status_code == 400


async def test_run_rejects_empty_sql(client: AsyncClient, auth: dict):
    resp = await client.post(
        "/api/v1/query/run", json={"sql": "", "datasource_id": None}, headers=auth
    )
    assert resp.status_code == 422  # pydantic min_length


async def test_run_requires_auth(client: AsyncClient):
    resp = await client.post(
        "/api/v1/query/run", json={"sql": "SELECT 1", "datasource_id": None}
    )
    assert resp.status_code == 401


async def test_run_rejects_missing_datasource(client: AsyncClient, auth: dict):
    resp = await client.post(
        "/api/v1/query/run",
        json={"sql": "SELECT * FROM sales", "datasource_id": "does-not-exist"},
        headers=auth,
    )
    assert resp.status_code == 404


async def test_run_result_feeds_analysis_panel(client: AsyncClient, auth: dict):
    """A manual-SQL run persists result_data so on-demand panels keep working."""
    run = await client.post(
        "/api/v1/query/run",
        json={
            "sql": "SELECT region, SUM(revenue) AS total FROM sales GROUP BY region",
            "datasource_id": None,
        },
        headers=auth,
    )
    qid = run.json()["query_log_id"]
    sig = await client.post(f"/api/v1/query/{qid}/significance", headers=auth)
    assert sig.status_code == 200, sig.text
