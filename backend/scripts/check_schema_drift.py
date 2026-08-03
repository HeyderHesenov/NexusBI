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
both OFF in Alembic's defaults. Measured on the schema this was written against:
3 differences with them off, 56 with them on -- and the 53rd was the rls_mode
server_default fixed in the same change, which is why the baseline holds 55.
Leaving them off would have made this guard look clean while it was blind to
exactly the kind of drift it exists to catch. app/db/migrations/env.py sets the
same two flags, so autogenerate and this audit agree on what a difference is.
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


def _qual(schema, table) -> str:
    """Schema-qualify, so same-named tables in two schemas cannot share a key.

    Unreachable while compare_metadata runs with include_schemas=False and no
    model sets __table_args__={'schema': ...}, but this function is what the
    whole ratchet's safety rests on, so it should not depend on that staying
    true."""
    return f"{schema}.{table}" if schema else str(table)


def _value(v) -> str:
    """Render one side of a modify_* difference so the key is about the VALUE.

    Casts and quoting are stripped because the two sides spell the same value
    differently -- Postgres reflects a default as "'strict'::character
    varying" while the model just says "strict" -- and a key that kept the
    spelling would treat a cosmetic difference as a real one.
    """
    if v is None:
        return "-"
    arg = getattr(v, "arg", v)              # DefaultClause -> its argument
    text = getattr(arg, "text", arg)        # TextClause -> its SQL
    out = str(text).split("::", 1)[0].strip().strip("'\"")
    return out.lower() or "-"


def key(diff) -> str:
    """A stable one-line identity for a difference.

    Two properties matter, and the first draft of this function had only one.

    Stable: built from names and normalised values, never from repr(). A key
    carrying an object's repr would embed a heap address, so the operator would
    paste a key into the baseline that never matches again -- the guard would
    then report it as both new drift and a stale entry, forever, with no fix
    available short of editing this file.

    Specific: a modify_* key names the values, not just the column. Keyed on the
    column alone, a single baseline line exempted that column from *every*
    future default change -- so a migration flipping workspace_members.role or
    workspace_resources.permission would sail past the guard built to catch
    exactly the rls_mode shape. Measured before the fix: giving the model a
    server_default the database disagreed with still exited 0.
    """
    op = diff[0]
    if op.startswith("modify_"):
        # (op, schema, table, column, {...}, old, new)
        return f"{op}:{_qual(diff[1], diff[2])}.{diff[3]}:{_value(diff[5])}->{_value(diff[6])}"
    if op in ("add_column", "remove_column"):
        # (op, schema, table, Column)
        return f"{op}:{_qual(diff[1], diff[2])}.{diff[3].name}"
    if op in ("add_table", "remove_table"):
        return f"{op}:{_qual(getattr(diff[1], 'schema', None), diff[1].name)}"
    if op in ("add_index", "remove_index"):
        return f"{op}:{_table_of(diff[1])}.{diff[1].name}"
    if op in ("add_constraint", "remove_constraint"):
        obj = diff[1]
        name = getattr(obj, "name", None)
        if not name:
            # Reflected constraints can come back unnamed. Columns alone are not
            # enough: a CheckConstraint over a text predicate has none, so two
            # different checks on one table would collapse into a single key and
            # one baseline line would accept both.
            cols = ",".join(c.name for c in getattr(obj, "columns", []))
            # `or ""` would be the obvious way to default this and it raises:
            # TextClause.__bool__ is undefined, so key() crashed on exactly the
            # unnamed CheckConstraint this branch exists to name.
            sqltext = getattr(obj, "sqltext", None)
            expr = "" if sqltext is None else str(sqltext)
            name = f"<unnamed:{type(obj).__name__}:{cols}:{expr}>"
        return f"{op}:{_table_of(obj)}.{name}"
    # Anything Alembic grows later lands here rather than being silently dropped.
    # Type names only -- see the "stable" note above on why not repr().
    return f"{op}:" + ",".join(type(x).__name__ for x in diff[1:])


def _load_baseline() -> set[str]:
    """A line is a comment only if it STARTS with '#'; there are no trailing ones.

    Stripping from the first '#' anywhere looked tidier and silently truncated
    every key whose value contains one -- brand_configs.primary_color defaults
    to '#0E9F6E', so its entry parsed as a prefix, matched nothing, and the
    guard reported the same difference as both new drift and a stale entry.
    """
    out: set[str] = set()
    with open(BASELINE, encoding="utf-8") as fh:
        for raw in fh:
            line = raw.strip()
            if line and not line.startswith("#"):
                out.add(line)
    return out


def _compare(conn) -> list:
    ctx = MigrationContext.configure(
        conn, opts={"compare_type": True, "compare_server_default": True}
    )
    return compare_metadata(ctx, Base.metadata)


async def _diff_keys() -> list[str]:
    engine = create_async_engine(settings.DATABASE_URL)
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
        # Counted from the database, not from the baseline file: reporting
        # len(baseline) would print a number that cannot move, so two
        # differences collapsing onto one key would look like business as usual.
        print(f"ok   schema matches the models, {len(set(found))} accepted difference(s)")
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
