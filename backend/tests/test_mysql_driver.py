"""MySQL connector fix — the async driver (aiomysql) is present and resolves.

DBType.mysql, the execute_select statement-timeout branch, and the sqlglot dialect
map were already MySQL-ready; the only gap was the missing async driver. These
tests lock in that a mysql+aiomysql:// URL now builds an engine (no NoSuchModuleError)
without needing a live MySQL server.
"""
from __future__ import annotations

import pytest

pytestmark = pytest.mark.asyncio


async def test_aiomysql_importable():
    import aiomysql  # noqa: F401


async def test_mysql_async_engine_resolves():
    from sqlalchemy.ext.asyncio import create_async_engine

    # Building the engine resolves the dialect+driver; it does NOT connect, so no
    # live MySQL server is needed. Before aiomysql was added this raised.
    engine = create_async_engine("mysql+aiomysql://user:pass@localhost:3306/db")
    try:
        assert engine.dialect.name == "mysql"
        assert engine.dialect.is_async
    finally:
        await engine.dispose()


async def test_dbtype_has_mysql():
    from app.models.datasource import DBType

    assert DBType.mysql.value == "mysql"


async def test_sql_guard_supports_mysql_dialect():
    from app.ai import sql_guard

    # allowlist + parse under the mysql dialect (maps to sqlglot 'mysql').
    sql_guard.assert_tables_in_schema("SELECT id FROM sales", ["sales"], "mysql")
    with pytest.raises(Exception):
        sql_guard.assert_tables_in_schema("SELECT * FROM secret", ["sales"], "mysql")
