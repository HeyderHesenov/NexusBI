"""The mutex around `alembic upgrade head`.

Two concurrent migrators corrupt the schema (see `app/db/migration_lock`), and
the failure is silent until some later query hits a duplicate column. These
tests pin the two things that make the guard real: it fires on Postgres, and
env.py still calls it.
"""
from __future__ import annotations

from pathlib import Path

from app.db.migration_lock import LOCK_TIMEOUT, MIGRATION_LOCK_KEY, lock_migrations


class _FakeDialect:
    def __init__(self, name: str) -> None:
        self.name = name


class _FakeConnection:
    """Records what would be sent to the database."""

    def __init__(self, dialect: str) -> None:
        self.dialect = _FakeDialect(dialect)
        self.statements: list[tuple[str, dict | None]] = []

    def execute(self, clause, params=None):
        self.statements.append((str(clause), params))
        return None


def test_postgres_takes_the_advisory_lock():
    conn = _FakeConnection("postgresql")
    lock_migrations(conn)

    sql = " ".join(s for s, _ in conn.statements)
    assert "pg_advisory_xact_lock" in sql
    # Transaction-scoped, so there must be no unlock to forget.
    assert "pg_advisory_unlock" not in sql
    assert LOCK_TIMEOUT in sql, "a wedged holder must fail the deploy, not hang it"
    assert conn.statements[-1][1] == {"key": MIGRATION_LOCK_KEY}


def test_sqlite_is_a_no_op():
    """No advisory locks, and no concurrent writers to protect from."""
    conn = _FakeConnection("sqlite")
    lock_migrations(conn)
    assert conn.statements == []


def test_env_py_locks_before_running_migrations_online():
    """A ratchet: losing this call would restore the race quietly.

    env.py runs migrations at import time, so it cannot be imported here — parse
    it instead. Scoped to `do_run_migrations`, the online path: offline mode
    (`alembic upgrade head --sql`) only prints SQL and never opens a connection,
    so there is nothing there to serialise.
    """
    import ast

    env_py = Path(__file__).resolve().parents[1] / "app" / "db" / "migrations" / "env.py"
    tree = ast.parse(env_py.read_text(encoding="utf-8"))
    online = next(
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.FunctionDef) and node.name == "do_run_migrations"
    )

    calls = [
        node.func.id
        for node in ast.walk(online)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
    ]
    assert "lock_migrations" in calls, "do_run_migrations must take the migration lock"

    body = ast.get_source_segment(env_py.read_text(encoding="utf-8"), online) or ""
    assert body.index("lock_migrations") < body.index("context.run_migrations()")


def test_migrations_do_not_run_in_the_app_lifespan():
    """N uvicorn workers means N concurrent migrators — the race, self-inflicted.

    The compose `migrate` service owns this instead.
    """
    main_py = Path(__file__).resolve().parents[1] / "app" / "main.py"
    source = main_py.read_text(encoding="utf-8")
    assert "upgrade" not in source or "alembic" not in source
