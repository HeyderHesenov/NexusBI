"""Cohort retention + funnel — pure compute, demo snapshot, and live guard."""
from __future__ import annotations

import pytest
from httpx import AsyncClient

from app.core.exceptions import InvalidSQLError, NexusBIException
from app.db import demo_data
from app.services import cohort_service


# ── Pure compute (data-source agnostic) ──────────────────────────────────── #
def test_retention_from_rows_builds_matrix():
    rows = [
        {"e": "a", "d": "2024-01-15"},
        {"e": "a", "d": "2024-02-03"},  # a: retained at +1
        {"e": "b", "d": "2024-01-20"},  # b: Jan cohort, no +1
        {"e": "c", "d": "2024-02-10"},  # c: Feb cohort
    ]
    data = cohort_service.retention_from_rows(rows, "e", "d")
    assert data["cohorts"] == ["2024-01", "2024-02"]
    assert data["sizes"] == [2, 1]  # Jan {a,b}, Feb {c}
    jan = data["cells"][0]
    assert jan[0]["count"] == 2 and jan[0]["pct"] == 100.0
    assert jan[1]["count"] == 1 and jan[1]["pct"] == 50.0  # only a retained
    assert data["offsets"] == [0, 1]  # global span: Jan reaches +1
    feb = data["cells"][1]
    assert feb[0]["count"] == 1  # Feb's own month
    assert feb[1] is None  # Feb +1 = March, beyond the observed calendar


def test_retention_from_rows_skips_bad_dates_and_null_entity():
    rows = [
        {"e": None, "d": "2024-01-01"},  # no entity
        {"e": "x", "d": "not-a-date"},  # unparseable
        {"e": "x", "d": "2024-03-01"},  # the only usable row
    ]
    data = cohort_service.retention_from_rows(rows, "e", "d")
    assert data["cohorts"] == ["2024-03"] and data["sizes"] == [1]


def test_retention_from_rows_empty():
    assert cohort_service.retention_from_rows([], "e", "d") == {
        "cohorts": [], "offsets": [], "sizes": [], "cells": []
    }


def test_funnel_from_counts_order_and_dropoff():
    counts = {"visit": 100, "signup": 60, "purchase": 20}
    data = cohort_service.funnel_from_counts(counts, ["visit", "signup", "purchase"])
    by = {s["name"]: s for s in data["steps"]}
    assert by["visit"]["pct_of_first"] == 100.0
    assert by["signup"]["drop_pct"] == 40.0  # 100 → 60
    assert by["purchase"]["pct_of_first"] == 20.0


def test_funnel_from_counts_clamps_growth():
    counts = {"a": 10, "b": 15, "c": 5}
    steps = cohort_service.funnel_from_counts(counts, ["a", "b", "c"])["steps"]
    assert steps[1]["drop_pct"] == 0.0  # grew — clamped, not negative


# ── Demo snapshot wrappers ───────────────────────────────────────────────── #
def test_funnel_demo_counts_are_exact():
    data = cohort_service.funnel_demo()
    by_name = {s["name"]: s for s in data["steps"]}
    assert [s["name"] for s in data["steps"]] == ["visit", "signup", "trial", "purchase"]
    assert by_name["visit"]["count"] == 60
    assert by_name["purchase"]["count"] == 20
    assert by_name["signup"]["drop_pct"] == 25.0  # 60 → 45


def test_retention_demo_matrix_shape_and_diagonal():
    data = cohort_service.retention_demo()
    assert len(data["cohorts"]) == 12
    assert data["sizes"] == [5] * 12
    for row in data["cells"]:
        assert row[0] is not None and row[0]["pct"] == 100.0


def test_retention_demo_january_cohort_steps_down():
    jan = cohort_service.retention_demo()["cells"][0]
    assert [c["count"] for c in jan[:5]] == [5, 4, 3, 2, 1]
    assert all(c is not None and c["count"] == 0 for c in jan[5:])


def test_retention_demo_beyond_calendar_is_none():
    december = cohort_service.retention_demo()["cells"][-1]
    assert december[0] is not None
    assert all(cell is None for cell in december[1:])


def test_counts_ignore_live_revenue_factors():
    before = cohort_service.funnel_demo()
    original = demo_data.current_live_factors()
    try:
        demo_data.set_live_factors({cat: 1.7 for cat in original})
        after = cohort_service.funnel_demo()
    finally:
        demo_data.set_live_factors(original)
    assert before == after


def test_snapshot_failure_raises_not_empty(monkeypatch):
    monkeypatch.setattr(
        "app.services.cohort_service.execute_demo_snapshot", lambda sqls: [None]
    )
    with pytest.raises(InvalidSQLError):
        cohort_service.retention_demo()
    with pytest.raises(InvalidSQLError):
        cohort_service.funnel_demo()


# ── Live-data guard (column whitelist, fail-closed) ──────────────────────── #
def test_safe_columns_rejects_unknown_table_and_column():
    with pytest.raises(NexusBIException):
        cohort_service._safe_columns("bad name!", ["a"], {"a"})
    with pytest.raises(NexusBIException):
        cohort_service._safe_columns("orders", ["ghost"], {"cust", "ts"})


async def test_retention_live_rejects_unmapped_column(monkeypatch):
    """A column not present in the datasource schema must fail closed."""
    monkeypatch.setattr(
        "app.services.cohort_service.datasource_service.get_datasource",
        lambda *a, **k: _async(object()),
    )
    monkeypatch.setattr(
        "app.services.cohort_service.datasource_service.get_schema_cached",
        lambda *a, **k: _async({"orders": [{"name": "cust", "type": "INT"}]}),
    )
    with pytest.raises(NexusBIException):
        await cohort_service.retention(
            None, None, "u1", "ds1", "orders", entity_col="cust", date_col="MISSING"
        )


async def test_retention_demo_when_no_datasource():
    data = await cohort_service.retention(None, None, "u1", None, None, None, None)
    assert len(data["cohorts"]) == 12  # demo matrix


async def test_retention_empty_when_datasource_but_incomplete_mapping():
    # A datasource selected with columns unmapped must NOT mix in demo data.
    data = await cohort_service.retention(None, None, "u1", "ds1", None, None, None)
    assert data == {"cohorts": [], "offsets": [], "sizes": [], "cells": []}
    funnel = await cohort_service.funnel(None, None, "u1", "ds1", "orders", "cust", None)
    assert funnel == {"steps": []}


async def _async(value):
    return value


# ── Endpoints (now POST; empty body → demo) ──────────────────────────────── #
async def test_endpoints_require_auth(client: AsyncClient):
    assert (await client.post("/api/v1/cohort/retention")).status_code == 401
    assert (await client.post("/api/v1/cohort/funnel")).status_code == 401


async def test_endpoints_return_demo_payload(client: AsyncClient, auth: dict):
    r = await client.post("/api/v1/cohort/retention", headers=auth, json={})
    assert r.status_code == 200, r.text
    assert r.json()["cohorts"] and r.json()["cells"]

    f = await client.post("/api/v1/cohort/funnel", headers=auth, json={})
    assert f.status_code == 200, f.text
    assert len(f.json()["steps"]) == 4


def test_rule_based_fallback_covers_events():
    from app.ai.rule_based_sql import generate_sql_fallback

    monthly = generate_sql_fallback("signup hadisələri ay üzrə").sql.lower()
    assert "from events" in monthly and "substr(event_date, 1, 7)" in monthly

    by_type = generate_sql_fallback("event count by type").sql.lower()
    assert "from events" in by_type and "event_type" in by_type

    sales = generate_sql_fallback("kateqoriya üzrə gəlir").sql.lower()
    assert "from sales" in sales


# ── Relocated-upload self-heal (project-move path fix) ───────────────────── #
def test_resolve_conn_str_remaps_relocated_sqlite(tmp_path):
    """A stale absolute path (project moved) self-heals to the file now living
    in UPLOAD_DIR under the same basename."""
    import os

    from app.core.security import encrypt_secret
    from app.models.datasource import DataSource, DBType
    from app.services import datasource_service as ds_svc
    from tests.conftest import seed_sqlite_file

    real = seed_sqlite_file("CREATE TABLE t (x INTEGER)")  # sqlite+aiosqlite:///<UPLOAD_DIR>/<uuid>.db
    basename = os.path.basename(real.split("///")[-1])
    stale = f"sqlite+aiosqlite:////nonexistent/old/project/{basename}"
    ds = DataSource(db_type=DBType.sqlite, connection_string_encrypted=encrypt_secret(stale))

    resolved = ds_svc._resolve_conn_str(ds)
    assert resolved == real  # remapped into the current UPLOAD_DIR
    assert os.path.exists(resolved.split("///")[-1])


def test_resolve_conn_str_missing_file_raises():
    from app.core.exceptions import DataSourceConnectionError
    from app.core.security import encrypt_secret
    from app.models.datasource import DataSource, DBType
    from app.services import datasource_service as ds_svc

    import pytest as _pytest

    stale = "sqlite+aiosqlite:////nonexistent/old/gone-a1b2c3.db"
    ds = DataSource(db_type=DBType.sqlite, connection_string_encrypted=encrypt_secret(stale))
    with _pytest.raises(DataSourceConnectionError):
        ds_svc._resolve_conn_str(ds)


def test_resolve_conn_str_leaves_existing_and_nonsqlite_untouched():
    from app.core.security import encrypt_secret
    from app.models.datasource import DataSource, DBType
    from app.services import datasource_service as ds_svc
    from tests.conftest import seed_sqlite_file

    real = seed_sqlite_file("CREATE TABLE t (x INTEGER)")
    ds = DataSource(db_type=DBType.sqlite, connection_string_encrypted=encrypt_secret(real))
    assert ds_svc._resolve_conn_str(ds) == real  # present → unchanged

    pg = "postgresql+asyncpg://u:p@db.example.com:5432/app"
    ds2 = DataSource(db_type=DBType.postgresql, connection_string_encrypted=encrypt_secret(pg))
    assert ds_svc._resolve_conn_str(ds2) == pg  # non-sqlite → untouched
