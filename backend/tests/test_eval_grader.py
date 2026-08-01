"""The eval grader's own tests.

The harness publishes an accuracy number, and every one of those points passes
through ``result_sets_equivalent``. A grader that is too generous inflates the
number; one that is too strict makes a correct engine look broken and invites
someone to lower the floor. So the comparator is pinned here before anything
depends on it.
"""
from __future__ import annotations

from decimal import Decimal

from tests.golden.grader import result_sets_equivalent

COLS = ["category", "total"]
ROWS = [
    {"category": "Books", "total": 100.0},
    {"category": "Home", "total": 250.5},
    {"category": "Sports", "total": 75.25},
]


def _eq(ref_cols, ref_rows, cand_cols, cand_rows, *, ordered=False) -> bool:
    return result_sets_equivalent(ref_cols, ref_rows, cand_cols, cand_rows, ordered=ordered)


def test_identical_result_sets_match():
    assert _eq(COLS, ROWS, COLS, ROWS)


def test_column_names_are_ignored():
    """`total_revenue` vs `sum_rev` is not a wrong answer."""
    renamed_cols = ["cat", "sum_rev"]
    renamed = [{"cat": r["category"], "sum_rev": r["total"]} for r in ROWS]
    assert _eq(COLS, ROWS, renamed_cols, renamed)


def test_column_order_is_ignored():
    flipped_cols = ["total", "category"]
    flipped = [{"total": r["total"], "category": r["category"]} for r in ROWS]
    assert _eq(COLS, ROWS, flipped_cols, flipped)


def test_row_order_ignored_when_unordered():
    shuffled = [ROWS[2], ROWS[0], ROWS[1]]
    assert _eq(COLS, ROWS, COLS, shuffled, ordered=False)


def test_row_order_enforced_when_ordered():
    """A "top 5 by revenue" question is answered wrong by the right rows in the
    wrong sequence."""
    shuffled = [ROWS[2], ROWS[0], ROWS[1]]
    assert not _eq(COLS, ROWS, COLS, shuffled, ordered=True)
    assert _eq(COLS, ROWS, COLS, list(ROWS), ordered=True)


def test_independently_shuffled_columns_do_not_match():
    """The case that rules out per-column comparison.

    Every category is present and every total is present — column-by-column this
    looks identical — but the pairing is wrong, so the answer is wrong.
    """
    mispaired = [
        {"category": "Books", "total": 250.5},
        {"category": "Home", "total": 75.25},
        {"category": "Sports", "total": 100.0},
    ]
    assert not _eq(COLS, ROWS, COLS, mispaired, ordered=False)


def test_float_noise_within_rounding_matches():
    """Summing floats in a different order differs in the last bits."""
    noisy = [{**r, "total": r["total"] + 0.004} for r in ROWS]
    assert _eq(COLS, ROWS, COLS, noisy)


def test_real_value_difference_does_not_match():
    off = [{**r, "total": r["total"] + 0.5} for r in ROWS]
    assert not _eq(COLS, ROWS, COLS, off)


def test_int_and_float_are_the_same_number():
    assert _eq(["n"], [{"n": 60}], ["n"], [{"n": 60.0}])


def test_decimal_is_compared_as_a_number():
    assert _eq(["n"], [{"n": 100.0}], ["n"], [{"n": Decimal("100.00")}])


def test_strings_are_stripped():
    assert _eq(["c"], [{"c": "Books"}], ["c"], [{"c": " Books "}])


def test_extra_column_does_not_match():
    wide_cols = [*COLS, "extra"]
    wide = [{**r, "extra": 1} for r in ROWS]
    assert not _eq(COLS, ROWS, wide_cols, wide)


def test_missing_column_does_not_match():
    narrow = [{"category": r["category"]} for r in ROWS]
    assert not _eq(COLS, ROWS, ["category"], narrow)


def test_row_count_difference_does_not_match():
    assert not _eq(COLS, ROWS, COLS, ROWS[:2])


def test_empty_against_populated_does_not_match():
    assert not _eq(COLS, ROWS, COLS, [])
    assert not _eq(COLS, [], COLS, ROWS)


def test_both_empty_with_same_width_match():
    assert _eq(COLS, [], COLS, [])


def test_nulls_are_compared_not_dropped():
    with_null = [{"c": "a", "n": None}, {"c": "b", "n": 1}]
    with_zero = [{"c": "a", "n": 0}, {"c": "b", "n": 1}]
    assert _eq(["c", "n"], with_null, ["c", "n"], list(with_null))
    assert not _eq(["c", "n"], with_null, ["c", "n"], with_zero)


def test_mixed_type_column_does_not_raise():
    """Sorting a column holding None, a number and a string must not TypeError."""
    mixed = [{"v": None}, {"v": 3}, {"v": "x"}]
    assert _eq(["v"], mixed, ["v"], [mixed[2], mixed[0], mixed[1]])


def test_ambiguous_columns_resolve_to_the_correct_pairing():
    """Two columns holding the same value multiset — the search must find the
    bijection that makes the ROWS line up, not stop at the first plausible one."""
    ref_rows = [{"a": 1, "b": 2}, {"a": 2, "b": 1}]
    # Same two columns, swapped: row (1,2) becomes (2,1). As an unordered set of
    # rows this is identical to the reference, so it is a correct answer.
    swapped = [{"x": 2, "y": 1}, {"x": 1, "y": 2}]
    assert _eq(["a", "b"], ref_rows, ["x", "y"], swapped, ordered=False)
    # But a pairing the reference never contains must be rejected.
    bogus = [{"x": 1, "y": 1}, {"x": 2, "y": 2}]
    assert not _eq(["a", "b"], ref_rows, ["x", "y"], bogus, ordered=False)


def test_single_scalar_results():
    assert _eq(["count"], [{"count": 60}], ["c"], [{"c": 60}])
    assert not _eq(["count"], [{"count": 60}], ["c"], [{"c": 59}])
