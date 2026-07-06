"""SQL execution-error self-repair loop (live datasource path)."""
from __future__ import annotations

import pytest
from httpx import AsyncClient

from app.ai.types import ChartConfig, Text2SQLResult
from app.services import query_service
from tests.conftest import seed_internal_datasource, seed_sqlite_file

_SCHEMA = "CREATE TABLE t (x INTEGER); INSERT INTO t VALUES (1),(2),(3);"


@pytest.fixture(autouse=True)
def _mock_chart_insight(monkeypatch):
    async def fake_chart(columns, data, nl):
        return ChartConfig(chart_type="table")

    async def fake_insight(data, nl, chart_type=""):
        return ""

    monkeypatch.setattr(query_service, "select_chart_type", fake_chart)
    monkeypatch.setattr(query_service, "generate_insight", fake_insight)


async def _ds(email: str = "test@nexusbi.io") -> str:
    return await seed_internal_datasource(email, "RepairSrc", seed_sqlite_file(_SCHEMA))


async def test_unit_repair_sql_corrects(monkeypatch):
    async def fake_chat_json(system, user, **kw):
        return {"sql": "SELECT x FROM t", "explanation": "fixed", "confidence": 0.9}

    from app.ai import text2sql
    monkeypatch.setattr(text2sql, "chat_json", fake_chat_json)
    eng = text2sql.Text2SQLEngine()
    out = await eng.repair_sql("neçə sətir", "SELECT missing FROM t", "no such column: missing", "t(x)")
    assert out.sql == "SELECT x FROM t"


async def test_bad_sql_is_repaired_and_executes(client: AsyncClient, auth: dict, monkeypatch):
    ds_id = await _ds()

    async def bad_gen(self, nl, schema, datasource_type="sqlite", extra_context=""):
        return Text2SQLResult(sql="SELECT missing_col FROM t", confidence=0.5)

    async def good_repair(self, nl, failed_sql, db_error, schema, datasource_type="sqlite", extra_context=""):
        assert "missing_col" in db_error or "missing_col" in failed_sql  # error is fed back
        return Text2SQLResult(sql="SELECT x FROM t", confidence=0.9)

    monkeypatch.setattr(query_service.Text2SQLEngine, "generate_sql", bad_gen)
    monkeypatch.setattr(query_service.Text2SQLEngine, "repair_sql", good_repair)

    resp = await client.post(
        "/api/v1/query/ask",
        json={"nl_query": "t sətirləri", "datasource_id": ds_id},
        headers=auth,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["sql"] == "SELECT x FROM t"  # the repaired SQL is what ran and is surfaced
    assert len(body["data"]) == 3


async def test_repair_exhausted_surfaces_error(client: AsyncClient, auth: dict, monkeypatch):
    ds_id = await _ds()

    async def bad_gen(self, nl, schema, datasource_type="sqlite", extra_context=""):
        return Text2SQLResult(sql="SELECT missing_col FROM t", confidence=0.5)

    async def still_bad_repair(self, nl, failed_sql, db_error, schema, datasource_type="sqlite", extra_context=""):
        return Text2SQLResult(sql="SELECT also_missing FROM t", confidence=0.5)

    monkeypatch.setattr(query_service.Text2SQLEngine, "generate_sql", bad_gen)
    monkeypatch.setattr(query_service.Text2SQLEngine, "repair_sql", still_bad_repair)

    resp = await client.post(
        "/api/v1/query/ask",
        json={"nl_query": "t sətirləri", "datasource_id": ds_id},
        headers=auth,
    )
    assert resp.status_code >= 400  # repair exhausted → surfaced failure


async def test_connection_error_is_not_repaired(client: AsyncClient, auth: dict, monkeypatch):
    """A timeout / connection failure (plain DataSourceConnectionError) must NOT trigger
    repair — the SQL is fine, the source is unreachable, so repairing wastes LLM calls."""
    from app.core.exceptions import DataSourceConnectionError

    ds_id = await _ds()
    repair_called = False

    async def gen(self, nl, schema, datasource_type="sqlite", extra_context=""):
        return Text2SQLResult(sql="SELECT x FROM t", confidence=0.9)

    async def guarded_boom(ds, sql, schema, db, user_id):
        raise DataSourceConnectionError("Bağlantı uğursuz.", detail="connection refused")

    async def repair_spy(self, *a, **k):
        nonlocal repair_called
        repair_called = True
        return Text2SQLResult(sql="SELECT x FROM t", confidence=0.9)

    monkeypatch.setattr(query_service.Text2SQLEngine, "generate_sql", gen)
    monkeypatch.setattr(query_service, "_guarded_execute", guarded_boom)
    monkeypatch.setattr(query_service.Text2SQLEngine, "repair_sql", repair_spy)

    resp = await client.post(
        "/api/v1/query/ask",
        json={"nl_query": "t sətirləri", "datasource_id": ds_id},
        headers=auth,
    )
    assert resp.status_code >= 400
    assert repair_called is False  # connection error was NOT fed into the repair loop
