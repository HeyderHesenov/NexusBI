"""Fail if the schema the migrations build disagrees with what the models declare.

The unit suite cannot answer this question, by construction: tests/conftest.py
builds the schema with `Base.metadata.create_all` and then stamps alembic_version
by hand so /ready is satisfied. So the tested schema comes from the models and
production's comes from the migrations, and nothing compares the two. `powerbi`
reached production through that gap; it is a class, not an incident.

Run against a live Postgres that has had `alembic upgrade head` applied --
deploy_smoke.sh does, in the backend container, next to check_enum_labels.py.
Placement matters for the same reason it does there: this proves what the
migrations actually produced, which reading their source cannot.

Ratchet, not a gate that must be green on day one. The differences that existed
when this was written are listed in schema_drift_baseline.txt with the reason
each was accepted; anything not on that list fails. The list may only shrink --
an entry that no longer reproduces also fails, so fixing drift without removing
its line is caught too.

NOTE ON THE COMPARISON FLAGS: `compare_type` and `compare_server_default` are
both OFF in Alembic's defaults. With them off this script reported 3
differences; with them on, 56. Leaving them off would have made this guard look
clean while it was blind to exactly the kind of drift it exists to catch.
"""
from __future__ import annotations

import asyncio
import os
import sys

import sqlalchemy as sa
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy.ext.asyncio import create_async_engine

# Running a script BY PATH puts its own directory on sys.path, not the working
# directory, so `import app` fails however sensible the CWD is. Same bootstrap as
# scripts/check_enum_labels.py; without it this only works under `python -m`.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import app.models  # noqa: E402,F401 — populates Base.metadata
from app.config import settings  # noqa: E402
from app.db.base import Base  # noqa: E402

BASELINE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "schema_drift_baseline.txt")


def _table_of(obj) -> str:
    table = getattr(obj, "table", None)
    return getattr(table, "name", None) or "<unknown>"


def key(diff) -> str:
    """A stable one-line identity for a difference.

    Deliberately coarse — table and column, not the rendered types. The point is
    "these two disagree about this column", and a key built from repr() would
    churn on SQLAlchemy version bumps and make the baseline unreviewable.
    """
    op = diff[0]
    if op.startswith("modify_"):
        # (op, schema, table, column, {...}, old, new)
        return f"{op}:{diff[2]}.{diff[3]}"
    if op in ("add_column", "remove_column"):
        # (op, schema, table, Column)
        return f"{op}:{diff[2]}.{diff[3].name}"
    if op in ("add_table", "remove_table"):
        return f"{op}:{diff[1].name}"
    if op in ("add_index", "remove_index"):
        return f"{op}:{_table_of(diff[1])}.{diff[1].name}"
    if op in ("add_constraint", "remove_constraint"):
        obj = diff[1]
        name = getattr(obj, "name", None)
        if not name:
            # Reflected unique constraints can come back unnamed; identify them
            # by the columns they cover so the baseline entry still means one
            # specific thing.
            cols = ",".join(c.name for c in getattr(obj, "columns", []))
            name = f"<unnamed:{cols}>"
        return f"{op}:{_table_of(obj)}.{name}"
    # Anything Alembic grows later lands here rather than being silently dropped.
    return f"{op}:{diff[1:]!r}"


def _load_baseline() -> set[str]:
    out: set[str] = set()
    with open(BASELINE, encoding="utf-8") as fh:
        for line in fh:
            line = line.split("#", 1)[0].strip()
            if line:
                out.add(line)
    return out


def _compare(conn) -> list:
    ctx = MigrationContext.configure(
        conn, opts={"compare_type": True, "compare_server_default": True}
    )
    return compare_metadata(ctx, Base.metadata)


async def _diff_keys() -> list[str]:
    engine = create_async_engine(settings.DATABASE_URL)
    if engine.dialect.name != "postgresql":
        await engine.dispose()
        return []
    try:
        async with engine.connect() as conn:
            raw = await conn.run_sync(_compare)
    finally:
        await engine.dispose()

    flat = []
    for d in raw:
        flat.extend(d if isinstance(d, list) else [d])
    return sorted(key(d) for d in flat)


async def main() -> int:
    engine_name = sa.engine.make_url(settings.DATABASE_URL).get_backend_name()
    if engine_name != "postgresql":
        print(f"skipped: {engine_name} is not the dialect production runs on")
        return 0

    found = await _diff_keys()
    baseline = _load_baseline()

    unexpected = sorted(set(found) - baseline)
    stale = sorted(baseline - set(found))

    for k in unexpected:
        print(
            f"FAIL new drift: {k}\n"
            "     The migrations and the models disagree here and nothing in the "
            "unit suite can see it, because tests build the schema from the "
            "models. Fix the migration (or the model), or -- if the difference "
            "is deliberate -- add the key to schema_drift_baseline.txt with the "
            "reason.",
            file=sys.stderr,
        )
    for k in stale:
        print(
            f"FAIL stale baseline entry: {k}\n"
            "     This difference no longer reproduces. Delete the line: the "
            "list may only shrink, and a stale entry would silently accept the "
            "drift coming back.",
            file=sys.stderr,
        )

    if not unexpected and not stale:
        print(f"ok   schema matches the models, {len(baseline)} accepted difference(s)")
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
