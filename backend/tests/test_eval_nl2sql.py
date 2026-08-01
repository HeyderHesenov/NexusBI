"""NL->SQL eval harness — publishes `nl2sql_exact@1` and gates on it.

Why this exists: every AI surface in the product (24 copilot tools, the query
pipeline, the dashboard planner) shipped with no accuracy measurement at all, so
no change to a prompt, a model or the schema-linking step could be shown to have
helped rather than hurt. This is the first number.

What is measured is the real production path — ``query_service._demo_pipeline``,
the same function ``process_nl_query`` calls in demo mode. Building a separate
"eval path" would measure the harness rather than the product.

Two engines, one golden set:

* **deterministic_fallback** — the default. ``conftest`` blanks ``AI_API_KEY``,
  ``client._preflight`` refuses before the network, and ``_demo_pipeline`` lands
  on ``rule_based_sql``. Costs nothing, runs on every PR, and is the tier that
  gates.
* **llm** — the real model, opt-in via ``NEXUSBI_EVAL_LLM=1``. Roughly 80
  completions per run; reported, never gated (a paid, non-deterministic engine
  must not be able to redden someone else's PR).

Grading is result-set equivalence, never SQL string match — see
``tests/golden/grader``. Candidate and reference are executed against ONE seeded
snapshot (``demo_data.execute_demo_snapshot``) so the live-feed multipliers,
which ``_seed`` folds into revenue, cannot make two runs of the same query
disagree.
"""
from __future__ import annotations

import asyncio
import contextlib
import os
from typing import Any

import pytest

from app.db import demo_data
from app.services import query_service
from tests.golden import report
from tests.golden.grader import result_sets_equivalent
from tests.golden.loader import GoldenCase, load_golden

CASES = load_golden()

# Ratchet floor for the tier the rule-based engine is expected to cover. Measured,
# never guessed. It may only ever go UP: `test_core_floor_is_not_stale` fails once
# the engine pulls clearly ahead of it, so a real improvement gets locked in
# instead of quietly buying slack for a later regression. Same ratchet idea as
# `test_architecture._UNLIMITED_MUTATING_ROUTES`.
#
# It sits at 1.00 because `core` *means* "inside the rule-based engine's envelope"
# — a question the engine cannot answer belongs in the `full` tier, not in core
# with the floor lowered to accommodate it. Deciding which tier a new case belongs
# to is the author's job; lowering this number is not the way to do it.
CORE_FLOOR = 1.00

# How far the measured score may run ahead of the floor before the floor is
# considered stale. Wide enough that adding a case or two does not nag.
_FLOOR_SLACK = 0.10


@contextlib.contextmanager
def _pinned_live_factors():
    """Neutralize the demo live-feed multipliers for the duration of the run.

    ``demo_feed`` random-walks these module-level factors and ``_seed`` folds them
    into revenue. ``test_live_refresh`` restores them, but only if it completes —
    and test order is not guaranteed. Cheap insurance against an unrelated failure
    silently changing what this measures.
    """
    baseline = demo_data.current_live_factors()
    demo_data.set_live_factors({k: 1.0 for k in baseline})
    try:
        yield
    finally:
        demo_data.set_live_factors(baseline)


def _columns_of(rows: list[dict[str, Any]]) -> list[str]:
    """Column names in SELECT order — dict preserves insertion order, and the
    snapshot helper returns rows only. An empty result yields no columns, which
    the grader correctly reads as "not the same shape"."""
    return list(rows[0].keys()) if rows else []


def _grade(case: GoldenCase, candidate_sql: str) -> bool:
    reference_rows, candidate_rows = demo_data.execute_demo_snapshot(
        [case.reference_sql, candidate_sql]
    )
    if reference_rows is None:
        raise AssertionError(f"{case.id}: reference SQL failed to execute")
    if candidate_rows is None:
        return False
    return result_sets_equivalent(
        _columns_of(reference_rows), reference_rows,
        _columns_of(candidate_rows), candidate_rows,
        ordered=case.ordered,
    )


async def _evaluate(cases: list[GoldenCase], expected_engine: str) -> report.EvalRun:
    run = report.EvalRun(engine=expected_engine)
    for case in cases:
        outcome = report.CaseOutcome(
            id=case.id, lang=case.lang, tier=case.tier, question=case.question, correct=False
        )
        try:
            sql, _cols, _rows, _conf, provenance = await query_service._demo_pipeline(
                case.question
            )
            outcome.generated_sql = sql
            if provenance != expected_engine:
                # The measurement is only meaningful if we know which engine
                # answered. A mismatch means configuration drifted, not that the
                # engine got the question wrong — so say so rather than score it.
                outcome.error = f"expected provenance {expected_engine!r}, got {provenance!r}"
            else:
                outcome.correct = _grade(case, sql)
        except Exception as exc:  # noqa: BLE001 — a harness must measure, not explode
            outcome.error = f"{type(exc).__name__}: {exc}"[:300]
        run.outcomes.append(outcome)
    return run


@pytest.fixture(scope="session")
def fallback_eval() -> report.EvalRun:
    """One pass of the golden set through the deterministic engine.

    Session-scoped and depended upon (rather than a test that runs first) so the
    floor assertions cannot be reordered or `-k`-filtered into passing without the
    measurement having happened.
    """
    with _pinned_live_factors():
        run = asyncio.run(_evaluate(CASES, "deterministic_fallback"))
    report.write(run)
    return run


# ─── The golden set itself ───

def test_golden_set_is_mirrored_across_languages():
    """Every question exists in both az and en over the same reference, which is
    what makes the language-parity number a comparison rather than a coincidence."""
    by_pair: dict[str, dict[str, GoldenCase]] = {}
    for case in CASES:
        by_pair.setdefault(case.pair_id, {})[case.lang] = case
    unpaired = sorted(pair for pair, langs in by_pair.items() if set(langs) != {"az", "en"})
    assert not unpaired, f"golden cases missing a language twin: {unpaired}"
    mismatched = sorted(
        pair for pair, langs in by_pair.items()
        if langs["az"].reference_sql != langs["en"].reference_sql
        or langs["az"].tier != langs["en"].tier
        or langs["az"].ordered != langs["en"].ordered
    )
    assert not mismatched, f"az/en twins disagree on the expected answer: {mismatched}"


@pytest.mark.parametrize("case", CASES, ids=lambda c: c.id)
def test_reference_sql_is_sane(case: GoldenCase):
    """Each reference must run, return rows, and match the shape its entry declares.

    ``expect`` is the independent half of the ground truth: the reference says how
    to compute the answer, ``expect`` says what the answer looks like. A reference
    that executes but answers a different question usually disagrees with its own
    declared shape, and this is where that shows up.
    """
    rows = demo_data.execute_demo_snapshot([case.reference_sql])[0]
    assert rows is not None, f"{case.id}: reference SQL did not execute"
    assert rows, f"{case.id}: reference SQL returned no rows — nothing to grade against"

    columns = _columns_of(rows)
    assert len(columns) == case.expect["columns"], (
        f"{case.id}: expected {case.expect['columns']} column(s), got {len(columns)}: {columns}"
    )
    if "rows" in case.expect:
        assert len(rows) == case.expect["rows"], (
            f"{case.id}: expected {case.expect['rows']} row(s), got {len(rows)}"
        )
    if "rows_min" in case.expect:
        assert len(rows) >= case.expect["rows_min"], (
            f"{case.id}: expected at least {case.expect['rows_min']} row(s), got {len(rows)}"
        )
    if "scalar" in case.expect:
        actual = next(iter(rows[0].values()))
        assert actual == case.expect["scalar"], (
            f"{case.id}: expected {case.expect['scalar']!r}, got {actual!r}"
        )


# ─── The measurement ───

def test_every_case_was_measured(fallback_eval: report.EvalRun):
    """The denominator is the whole golden set. A case that errored out is scored
    as wrong, never dropped — a metric whose denominator can shrink is a metric
    that can be improved by breaking a case."""
    assert len(fallback_eval.outcomes) == len(CASES)
    assert {o.id for o in fallback_eval.outcomes} == {c.id for c in CASES}


def test_fallback_engine_actually_answered(fallback_eval: report.EvalRun):
    """No case may fail because the wrong engine ran or the pipeline raised.

    Being wrong is data. Not running is a broken harness, and the two must not be
    allowed to look alike in the published number.
    """
    broken = [(o.id, o.error) for o in fallback_eval.outcomes if o.error]
    assert not broken, f"pipeline did not produce an answer for: {broken}"


def test_core_tier_meets_floor(fallback_eval: report.EvalRun):
    correct, total = fallback_eval.rate(tier="core")
    score = correct / total
    assert score >= CORE_FLOOR, (
        f"nl2sql_exact@1 on the core tier fell to {score:.2f} ({correct}/{total}), "
        f"below the {CORE_FLOOR:.2f} floor. Failing cases: "
        f"{[o.id for o in fallback_eval.outcomes if o.tier == 'core' and not o.correct]}"
    )


def test_core_floor_is_not_stale(fallback_eval: report.EvalRun):
    """Keeps the ratchet honest — a real improvement must raise the floor."""
    correct, total = fallback_eval.rate(tier="core")
    score = correct / total
    assert score < CORE_FLOOR + _FLOOR_SLACK, (
        f"nl2sql_exact@1 on the core tier is now {score:.2f} ({correct}/{total}), "
        f"well clear of the {CORE_FLOOR:.2f} floor — raise CORE_FLOOR to lock the gain in."
    )


# ─── The paid run ───

@pytest.mark.eval_llm
def test_nl2sql_llm_eval(monkeypatch):
    """Score the same golden set against the real model. Opt-in, never gated.

    ``conftest`` blanks ``AI_API_KEY`` unconditionally to keep the suite hermetic,
    so the key arrives through a separate variable and is put back here — that is
    also what keeps a stray ``AI_API_KEY`` in someone's environment from silently
    turning every CI run into a paid one.
    """
    if os.getenv("NEXUSBI_EVAL_LLM") != "1":
        pytest.skip("set NEXUSBI_EVAL_LLM=1 to run the paid NL->SQL eval")
    key = os.getenv("NEXUSBI_EVAL_AI_KEY", "")
    if not key:
        pytest.skip("NEXUSBI_EVAL_AI_KEY is required — conftest blanks AI_API_KEY")

    from app.ai import client
    from app.config import settings

    monkeypatch.setattr(settings, "AI_API_KEY", key)
    monkeypatch.setattr(client, "_client", None)  # rebuild the singleton with this key

    with _pinned_live_factors():
        run = asyncio.run(_evaluate(CASES, "llm"))
    payload = report.write(run)

    answered = [o for o in run.outcomes if not o.error]
    assert answered, f"the model answered nothing: {[o.error for o in run.outcomes][:3]}"
    # Reported, not gated: this run costs money and is not deterministic.
    print("\n" + "\n".join(report.terminal_lines()))
    assert payload["overall"]["total"] == len(CASES)
