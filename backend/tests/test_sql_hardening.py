"""Text2SQL hardening: metadata denylist, schema allowlist, generation cache."""
from __future__ import annotations

import pytest

from app.ai import sql_guard
from app.ai.types import Text2SQLResult
from app.core.exceptions import InvalidSQLError
from app.services import query_service
from app.services.cache_service import CacheService


# ─── Metadata / catalog denylist (defense in depth, no schema needed) ───
@pytest.mark.parametrize(
    "sql",
    [
        "SELECT * FROM sqlite_master",
        "SELECT name FROM information_schema.tables",
        "SELECT relname FROM pg_catalog.pg_class",
        "SELECT * FROM pg_stat_activity",
        # Quoted-identifier evasions must NOT bypass the denylist.
        'SELECT * FROM "pg_catalog"."pg_class"',
        'SELECT * FROM "sqlite_master"',
        'SELECT * FROM "information_schema".tables',
        "SELECT * FROM [sqlite_master]",
        "SELECT * FROM `mysql`.`user`",
    ],
)
def test_metadata_tables_blocked(sql):
    with pytest.raises(InvalidSQLError):
        sql_guard.validate_select_only(sql)


def test_catalog_name_inside_string_literal_is_allowed():
    # 'pg_catalog' as DATA (not a table) must not false-positive.
    assert sql_guard.validate_select_only("SELECT * FROM sales WHERE note = 'pg_catalog'")


def test_ordinary_select_passes_guard():
    assert sql_guard.validate_select_only("SELECT * FROM sales") == "SELECT * FROM sales"


# ─── Positive schema allowlist ───
def test_allowlist_rejects_unknown_table():
    with pytest.raises(InvalidSQLError):
        sql_guard.assert_tables_in_schema(
            "SELECT * FROM secret_other_db", ["sales", "users"], "sqlite"
        )


def test_allowlist_allows_known_and_cte():
    # CTE name `t` is not a base table; `sales` is allowed → no raise.
    sql_guard.assert_tables_in_schema(
        "WITH t AS (SELECT * FROM sales) SELECT * FROM t", ["sales"], "postgresql"
    )


def test_allowlist_unparseable_fails_closed():
    with pytest.raises(InvalidSQLError):
        sql_guard.assert_tables_in_schema("SELEC (((", ["sales"], "sqlite")


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT * FROM secret_schema.sales",  # same bare name, other schema
        'SELECT * FROM "pg_catalog".sales',
        "SELECT * FROM otherdb.public.sales",
    ],
)
def test_allowlist_rejects_schema_qualified(sql):
    # Bare name 'sales' is allowed, but a schema/catalog qualifier escapes the
    # introspected (default-schema) boundary → must be rejected.
    with pytest.raises(InvalidSQLError):
        sql_guard.assert_tables_in_schema(sql, ["sales"], "postgresql")


# ─── Generation cache: second identical request skips the AI call ───
class _MemCache(CacheService):
    def __init__(self):
        super().__init__(None)
        self.store = {}

    async def get(self, key):
        return self.store.get(key)

    async def set(self, key, value, ttl=3600):
        self.store[key] = value


@pytest.mark.asyncio
async def test_generation_cache_hits(monkeypatch):
    calls = {"n": 0}

    async def fake_generate(nl, schema, dialect, extra):
        calls["n"] += 1
        return Text2SQLResult(sql="SELECT 1")

    monkeypatch.setattr(query_service._engine, "generate_sql", fake_generate)
    cache = _MemCache()
    r1 = await query_service._generate_sql_cached("q", "schema", "sqlite", "", cache)
    r2 = await query_service._generate_sql_cached("q", "schema", "sqlite", "", cache)
    assert r1.sql == r2.sql == "SELECT 1"
    assert calls["n"] == 1  # second call served from cache, no AI


@pytest.mark.asyncio
async def test_generation_cache_key_varies_by_question(monkeypatch):
    calls = {"n": 0}

    async def fake_generate(nl, schema, dialect, extra):
        calls["n"] += 1
        return Text2SQLResult(sql="SELECT 1")

    monkeypatch.setattr(query_service._engine, "generate_sql", fake_generate)
    cache = _MemCache()
    await query_service._generate_sql_cached("q1", "schema", "sqlite", "", cache)
    await query_service._generate_sql_cached("q2", "schema", "sqlite", "", cache)
    assert calls["n"] == 2  # different question → distinct key → fresh generation
