"""What can be asserted about schema drift without a Postgres to ask.

The authoritative check is scripts/check_schema_drift.py, which deploy_smoke.sh
runs against a real migrated database. These tests cover the parts that do not
need one: the invariant the drift actually broke, and the key/baseline
machinery the ratchet's whole safety argument rests on.
"""
from __future__ import annotations

import importlib.util
import re
from functools import lru_cache
from pathlib import Path

import pytest
import sqlalchemy as sa

from app.models.datasource import RLS_OPEN, RLS_STRICT, DataSource
from app.schemas.datasource import DataSourceResponse

_SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"


@lru_cache(maxsize=1)
def _guard():
    """Loaded once per session: the module body inserts the backend directory at
    the front of sys.path, so re-executing it per test would leave a stack of
    duplicate entries behind for everything that runs after."""
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

    Compared exactly, through the guard's own normaliser. An earlier version
    asserted `RLS_STRICT in rendered` to cope with the quoting, and 'strict' is
    a substring of 'restrict' -- a plausible typo would have kept this green
    while every non-ORM INSERT wrote a value rls_service treats as not-strict.
    """
    col = DataSource.__table__.c.rls_mode

    assert col.default is not None and col.default.arg == RLS_STRICT
    assert col.server_default is not None
    assert _guard()._value(col.server_default) == RLS_STRICT


def test_response_schema_does_not_default_rls_mode_to_the_permissive_value():
    """The third copy of this value. Every construction is model_validate() off an
    ORM row today, so a default was unreachable — and it sat at 'open', which is
    what a caller building the response from a dict or a cache entry would have
    reported for a locked source."""
    field = DataSourceResponse.model_fields["rls_mode"]
    assert field.is_required(), "a default here is a third value to keep in step"
    assert field.default != RLS_OPEN


@pytest.mark.parametrize(
    "diff, expected",
    [
        (("modify_default", None, "datasources", "rls_mode", {}, sa.text("'strict'"), "strict"),
         "modify_default:datasources.rls_mode:strict->strict"),
        (("modify_nullable", None, "users", "email", {}, False, True),
         "modify_nullable:users.email:false->true"),
        (("add_column", None, "alerts", sa.Column("cooldown_minutes", sa.Integer())),
         "add_column:alerts.cooldown_minutes"),
    ],
)
def test_key_identifies_a_difference_by_target_and_value(diff, expected):
    assert _guard().key(diff) == expected


def test_key_separates_two_different_default_changes_on_one_column():
    """The flaw the first draft shipped with.

    Keyed on the column alone, one baseline line exempted that column from every
    future default change. Measured then: giving workspace_members.role a model
    server_default the database disagreed with still exited 0, because
    `modify_default:workspace_members.role` was already accepted. Five
    permission-bearing columns sit in that list.
    """
    k = _guard().key
    viewer = ("modify_default", None, "workspace_members", "role", {}, sa.text("'viewer'"), None)
    admin = ("modify_default", None, "workspace_members", "role", {}, sa.text("'viewer'"), "admin")
    assert k(viewer) != k(admin)


def test_key_ignores_how_a_dialect_spells_the_same_value():
    """Postgres reflects a default as "'strict'::character varying" and the model
    just says "strict"; a key that kept the spelling would report a cosmetic
    difference as a real one, forever."""
    k = _guard().key
    cast = ("modify_default", None, "t", "c", {}, sa.text("'strict'::character varying"), None)
    plain = ("modify_default", None, "t", "c", {}, "strict", None)
    assert k(cast) == k(plain)


def test_key_for_an_unknown_shape_is_deterministic_and_address_free():
    """An unrecognised operation must still produce a key -- so it fails as new
    drift rather than vanishing -- and that key has to survive a second run.

    A repr()-based key embeds a heap address, so the operator would paste a line
    into the baseline that never matches again: the guard would then report the
    same thing as new drift AND as a stale entry on every run, with no fix short
    of editing the script.
    """
    k = _guard().key
    diff = ("some_future_op", sa.DefaultClause(sa.text("now()")))
    assert k(diff).startswith("some_future_op:")
    assert "0x" not in k(diff)
    assert k(diff) == k(("some_future_op", sa.DefaultClause(sa.text("now()"))))


def test_key_separates_two_unnamed_constraints_on_one_table():
    """Reflected constraints can arrive unnamed, and a CheckConstraint over a text
    predicate has no columns -- so identifying them by columns alone collapsed
    every unnamed constraint on a table into a single accepted key."""
    k = _guard().key
    t = sa.Table("t", sa.MetaData(), sa.Column("a", sa.Integer), sa.Column("b", sa.Integer))
    c1 = sa.CheckConstraint("a > 0", table=t)
    c2 = sa.CheckConstraint("b < 10", table=t)
    assert k(("add_constraint", c1)) != k(("add_constraint", c2))


def test_baseline_entries_are_unique_and_well_formed():
    mod = _guard()
    entries = [
        ln.strip()
        for ln in Path(mod.BASELINE).read_text(encoding="utf-8").splitlines()
        if ln.strip() and not ln.strip().startswith("#")
    ]

    assert entries, "the baseline is empty — the guard would accept nothing"
    assert len(entries) == len(set(entries)), "duplicate baseline entries"
    for e in entries:
        assert ":" in e, f"{e!r} is not an <op>:<target> key"

    # The whole point of the fix that shipped with this guard: rls_mode is not an
    # accepted difference, it is a corrected one.
    assert not any("datasources.rls_mode" in e for e in entries)


def test_baseline_keeps_a_value_that_contains_a_hash():
    """brand_configs.primary_color defaults to '#0E9F6E'.

    The first parser stripped from the first '#' anywhere on the line, so that
    key was silently truncated to a prefix: it matched nothing, and the guard
    reported the one difference as both new drift and a stale entry.
    """
    entries = _guard()._load_baseline()
    hashed = [e for e in entries if "#" in e]
    assert hashed, "expected at least one baselined default containing '#'"
    for e in hashed:
        assert e.endswith(">-") or "->" in e, f"{e!r} looks truncated"


def test_every_baseline_group_states_a_count_that_matches_its_entries():
    """A bare list of 55 keys is not a decision; the grouped reasons are.

    Asserting only that some prose exists let a third, undocumented group be
    appended silently -- and let a header's count drift away from what sits
    under it, which had already happened twice in this change's own comments.
    """
    raw = Path(_guard().BASELINE).read_text(encoding="utf-8")

    assert "RATCHET" in raw and "may only shrink" in raw

    groups: list[tuple[str, int, int]] = []   # (title, declared, actual)
    for line in raw.splitlines():
        s = line.strip()
        if s.startswith("# ──"):
            m = re.search(r"\((\d+)\)\s*$", s)
            assert m, f"group header states no count: {s!r}"
            groups.append((s, int(m.group(1)), 0))
        elif s and not s.startswith("#"):
            assert groups, f"entry {s!r} appears before any group header"
            title, declared, actual = groups[-1]
            groups[-1] = (title, declared, actual + 1)

    assert len(groups) >= 2
    for title, declared, actual in groups:
        assert declared == actual, f"{title!r} declares {declared} entries, holds {actual}"
