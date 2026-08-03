"""What can be asserted about schema drift without a Postgres to ask.

The authoritative check is scripts/check_schema_drift.py, which deploy_smoke.sh
runs against a real migrated database. These tests cover the parts that do not
need one: the invariant the drift actually broke, and the machinery the ratchet
depends on.
"""
from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa

from app.models.datasource import RLS_STRICT, DataSource

_SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"


def _guard():
    spec = importlib.util.spec_from_file_location(
        "check_schema_drift", _SCRIPTS / "check_schema_drift.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_rls_mode_python_and_server_defaults_agree():
    """The column's own comment states this invariant; for a while the code broke it.

    a0b1c2d3e4f5 moved the database default to 'strict' and the model was left
    saying server_default='open'. Postgres was right, so production was never
    fail-open -- but the models are what tests/conftest.py builds its schema
    from, so the *tested* schema was the fail-open one, and no test could see it
    because tests never run the migrations.

    Both halves matter: the Python default covers ORM inserts, the server
    default covers everything else (bulk import, an ops fix, a cloning
    migration).
    """
    col = DataSource.__table__.c.rls_mode

    assert col.default is not None and col.default.arg == RLS_STRICT
    assert col.server_default is not None
    rendered = str(col.server_default.arg)
    assert RLS_STRICT in rendered, (
        f"server_default is {rendered!r}, not {RLS_STRICT!r} — a non-ORM INSERT "
        "would fall back to the permissive mode"
    )


@pytest.mark.parametrize(
    "diff, expected",
    [
        (("modify_default", None, "datasources", "rls_mode", {}, None, None),
         "modify_default:datasources.rls_mode"),
        (("modify_nullable", None, "users", "email", {}, None, None),
         "modify_nullable:users.email"),
        (("add_column", None, "alerts", sa.Column("cooldown_minutes", sa.Integer())),
         "add_column:alerts.cooldown_minutes"),
    ],
)
def test_key_identifies_a_difference_by_table_and_column(diff, expected):
    """The baseline is a list of these strings, so they have to be stable.

    Keyed on table and column rather than on a rendered type: a key built from
    repr() would churn on a SQLAlchemy bump and turn the whole baseline over
    without a single real change.
    """
    assert _guard().key(diff) == expected


def test_key_does_not_silently_drop_a_shape_it_does_not_know():
    """An unrecognised operation must still produce a key, so it lands in the
    "new drift" bucket and fails, rather than vanishing from the comparison."""
    assert _guard().key(("some_future_op", "payload")).startswith("some_future_op:")


def test_baseline_entries_are_unique_and_well_formed():
    mod = _guard()
    raw = Path(mod.BASELINE).read_text(encoding="utf-8")
    entries = [ln.split("#", 1)[0].strip() for ln in raw.splitlines()]
    entries = [e for e in entries if e]

    assert entries, "the baseline is empty — the guard would accept nothing"
    assert len(entries) == len(set(entries)), "duplicate baseline entries"
    for e in entries:
        assert ":" in e, f"{e!r} is not an <op>:<target> key"

    # The whole point of the fix that shipped with this guard: rls_mode is not an
    # accepted difference, it is a corrected one.
    assert not any("datasources.rls_mode" in e for e in entries)


def test_baseline_documents_every_group_it_accepts():
    """A bare list of 55 keys is not a decision; the reasons are the artefact."""
    raw = Path(_guard().BASELINE).read_text(encoding="utf-8")
    assert "RATCHET" in raw and "may only shrink" in raw
    assert raw.count("# ──") >= 2, "each accepted group needs its own explanation"
