"""Result-set equivalence for the NL->SQL eval harness.

Grading generated SQL by string match against a reference measures the wrong
thing: ``SELECT category, SUM(revenue) ... GROUP BY category`` and
``SELECT s.category, SUM(s.revenue) ... GROUP BY 1`` are the same answer and
would score zero against each other. What a user cares about is the table that
comes back, so that is what this compares.

Three things vary freely between two correct answers and are therefore ignored:

* **Column names.** ``total_revenue`` vs ``sum_rev`` is not a wrong answer.
* **Column order.** ``(category, total)`` vs ``(total, category)`` likewise.
* **Row order**, but only when the question did not ask for one. "top 5 by
  revenue" *does* ask, so the caller passes ``ordered=True`` for those.

What must NOT vary is which values sit together in a row. Comparing each column
independently would let a candidate that pairs every category with the wrong
revenue pass — the multiset of categories and the multiset of revenues would
both still match. So the comparison always runs on whole row tuples, and the
column bijection is searched for rather than assumed (the Spider benchmark's
``eval_exec_match`` does the same).

Note on duplicate column names: rows arrive as dicts, so ``SELECT a, a`` has
already collapsed to one key before it reaches here. Golden entries do not use
duplicate output names.
"""
from __future__ import annotations

from decimal import Decimal
from typing import Any

# The demo seed rounds revenue to 2 places (``demo_data._seed``), and SUM over
# floats is order-sensitive in the last bits, so two correct aggregations can
# differ at the 12th decimal. Round to the precision the data actually carries.
_FLOAT_PLACES = 2

# Ceiling on how many column bijections get a full row comparison. Only reached
# when many columns share an identical value multiset (e.g. several all-zero
# columns), where the search would otherwise be factorial. Real cases here have
# at most four columns; hitting the cap means "not equivalent as far as we
# looked", which is the safe answer for a metric that must never over-report.
_MAX_BIJECTION_ATTEMPTS = 2000


def _norm(value: Any) -> Any:
    """Canonical form of one cell.

    ``bool`` deliberately falls through to the numeric branch: sqlite hands back
    1/0 where another engine might hand back True/False, and those are the same
    answer.
    """
    if value is None:
        return None
    if isinstance(value, Decimal):
        value = float(value)
    if isinstance(value, (int, float)):
        return round(float(value), _FLOAT_PLACES)
    if isinstance(value, str):
        return value.strip()
    return str(value)


def _sort_key(value: Any) -> tuple[int, float, str]:
    """Total order over normalized cells — sorting a column that mixes None,
    numbers and strings would otherwise raise TypeError."""
    if value is None:
        return (0, 0.0, "")
    if isinstance(value, (int, float)):
        return (1, float(value), "")
    return (2, 0.0, str(value))


def _row_key(row: tuple[Any, ...]) -> tuple[tuple[int, float, str], ...]:
    return tuple(_sort_key(v) for v in row)


def _matrix(columns: list[str], rows: list[dict[str, Any]]) -> list[list[Any]]:
    """Rows as normalized value lists, in ``columns`` order."""
    return [[_norm(row.get(col)) for col in columns] for row in rows]


def _column_multiset(matrix: list[list[Any]], index: int) -> tuple[Any, ...]:
    return tuple(sorted((row[index] for row in matrix), key=_sort_key))


def _column_sequence(matrix: list[list[Any]], index: int) -> tuple[Any, ...]:
    return tuple(row[index] for row in matrix)


def result_sets_equivalent(
    ref_columns: list[str],
    ref_rows: list[dict[str, Any]],
    cand_columns: list[str],
    cand_rows: list[dict[str, Any]],
    *,
    ordered: bool,
) -> bool:
    """True when the candidate result set answers the question the reference does.

    ``ordered=True`` additionally requires the rows to come back in the same
    sequence — use it for questions that name an order ("top 5", "ən çox satan",
    a time trend) and only for those, or every correct unordered answer scores
    as a miss.
    """
    if len(ref_columns) != len(cand_columns):
        return False
    if len(ref_rows) != len(cand_rows):
        return False
    if not ref_rows:
        # Same width, both empty. A golden entry whose reference returns nothing
        # is a defective entry, and `test_reference_sql_is_sane` rejects it there
        # rather than letting it pass everything here.
        return True

    width = len(ref_columns)
    ref = _matrix(ref_columns, ref_rows)
    cand = _matrix(cand_columns, cand_rows)

    # Prune before searching: a candidate column can only stand in for a
    # reference column if it holds the same values at all. Under `ordered` the
    # rows may not be permuted, so the sequences must match exactly.
    if ordered:
        ref_sig = [_column_sequence(ref, i) for i in range(width)]
        cand_sig = [_column_sequence(cand, j) for j in range(width)]
    else:
        ref_sig = [_column_multiset(ref, i) for i in range(width)]
        cand_sig = [_column_multiset(cand, j) for j in range(width)]

    options: list[list[int]] = [
        [j for j in range(width) if cand_sig[j] == ref_sig[i]] for i in range(width)
    ]
    if any(not opt for opt in options):
        return False

    ref_rows_norm = [tuple(row) for row in ref]
    if not ordered:
        ref_sorted = sorted(ref_rows_norm, key=_row_key)

    attempts = 0

    def rows_match(mapping: list[int]) -> bool:
        nonlocal attempts
        attempts += 1
        cand_rows_norm = [tuple(row[j] for j in mapping) for row in cand]
        if ordered:
            return cand_rows_norm == ref_rows_norm
        return sorted(cand_rows_norm, key=_row_key) == ref_sorted

    def walk(i: int, used: frozenset[int], mapping: list[int]) -> bool:
        if attempts >= _MAX_BIJECTION_ATTEMPTS:
            return False
        if i == width:
            return rows_match(mapping)
        for j in options[i]:
            if j in used:
                continue
            mapping.append(j)
            if walk(i + 1, used | {j}, mapping):
                return True
            mapping.pop()
        return False

    return walk(0, frozenset(), [])
