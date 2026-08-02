"""Fail if a database enum type is missing a label the models can emit.

SQLAlchemy does not diff enum members and neither does Alembic autogenerate, so
adding a value to a Python enum changes nothing in the database. SQLite renders
Enum as VARCHAR and accepts anything, which is how `powerbi` reached production
in DBType with no matching ALTER TYPE: every test passed and
POST /datasource/connect-powerbi failed on Postgres only.

Run against a live Postgres -- deploy_smoke.sh does, inside the backend
container, right after `alembic upgrade head`. That placement matters: it proves
the migrations actually produced the type, which grepping their source cannot.
"""
from __future__ import annotations

import asyncio
import sys

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import create_async_engine

import app.models  # noqa: F401 — populates Base.metadata
from app.config import settings
from app.db.base import Base


def _expected() -> dict[str, set[str]]:
    """Enum type name -> labels the models can write. Native types only: a
    non-native Enum is a VARCHAR on every dialect and has nothing to check."""
    out: dict[str, set[str]] = {}
    for table in Base.metadata.tables.values():
        for col in table.columns:
            t = col.type
            if isinstance(t, sa.Enum) and getattr(t, "native_enum", True) and t.name:
                out.setdefault(t.name, set()).update(t.enums)
    return out


async def main() -> int:
    expected = _expected()
    if not expected:
        print("no native enum columns in the models — nothing to check")
        return 0

    engine = create_async_engine(settings.DATABASE_URL)
    if engine.dialect.name != "postgresql":
        print(f"skipped: {engine.dialect.name} has no catalog of enum labels to read")
        await engine.dispose()
        return 0
    try:
        async with engine.connect() as conn:
            rows = (await conn.execute(sa.text(
                "SELECT t.typname, e.enumlabel FROM pg_enum e "
                "JOIN pg_type t ON t.oid = e.enumtypid"
            ))).all()
    finally:
        await engine.dispose()

    actual: dict[str, set[str]] = {}
    for typname, label in rows:
        actual.setdefault(typname, set()).add(label)

    failed = False
    for name, labels in sorted(expected.items()):
        missing = sorted(labels - actual.get(name, set()))
        if missing:
            failed = True
            print(
                f"FAIL {name}: the models can write {missing} but the type only has "
                f"{sorted(actual.get(name, set()))}. Add a migration with "
                f"ALTER TYPE {name} ADD VALUE.",
                file=sys.stderr,
            )
        else:
            print(f"ok   {name}: {sorted(labels)}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
