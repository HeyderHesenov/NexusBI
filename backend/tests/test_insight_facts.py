"""Unit tests for deterministic insight facts (pure, no AI, no DB)."""
from __future__ import annotations

from app.services.insight_facts import compute_facts


def _kinds(facts):
    return {f["kind"] for f in facts}


def test_top_contributor_and_total():
    cols = ["product", "revenue"]
    rows = [
        {"product": "A", "revenue": 100},
        {"product": "B", "revenue": 300},
        {"product": "C", "revenue": 100},
    ]
    facts = compute_facts(cols, rows)
    kinds = _kinds(facts)
    assert "total" in kinds and "top" in kinds
    total = next(f for f in facts if f["kind"] == "total")
    assert total["value"] == "500"
    top = next(f for f in facts if f["kind"] == "top")
    assert top["label"] == "B"
    assert "60%" in top["value"]  # 300 / 500


def test_period_delta_for_dated_series():
    cols = ["month", "revenue"]
    rows = [{"month": f"2026-{m:02d}", "revenue": 100 + 10 * m} for m in range(1, 7)]
    facts = compute_facts(cols, rows)
    trend = next((f for f in facts if f["kind"] == "trend"), None)
    assert trend is not None
    assert trend["value"].startswith("+")  # rising series


def test_no_period_delta_for_categorical():
    cols = ["product", "revenue"]
    rows = [{"product": p, "revenue": v} for p, v in [("A", 10), ("B", 20)]]
    assert "trend" not in _kinds(compute_facts(cols, rows))


def test_anomaly_fact_counts_outliers():
    cols = ["month", "revenue"]
    vals = [100, 105, 98, 102, 500, 101, 99]
    rows = [{"month": f"2026-{m:02d}", "revenue": v} for m, v in enumerate(vals, start=1)]
    anomaly = next((f for f in compute_facts(cols, rows) if f["kind"] == "anomaly"), None)
    assert anomaly is not None
    assert anomaly["value"] == "1"


def test_no_numeric_column_returns_empty():
    assert compute_facts(["name"], [{"name": "A"}, {"name": "B"}]) == []


def test_empty_input_returns_empty():
    assert compute_facts([], []) == []
    assert compute_facts(["x"], []) == []


def test_measure_is_last_numeric_not_a_dimension():
    # ["year", "revenue"] — year is numeric but a dimension; the measure is revenue.
    cols = ["year", "revenue"]
    rows = [{"year": 2024, "revenue": 100}, {"year": 2025, "revenue": 300}]
    facts = compute_facts(cols, rows)
    total = next(f for f in facts if f["kind"] == "total")
    assert total["value"] == "400"  # sum of revenue, NOT year (4049)


def test_numeric_column_with_null_first_row_still_detected():
    cols = ["month", "revenue"]
    rows = [
        {"month": "2026-01", "revenue": None},  # NULL first row must not hide the column
        {"month": "2026-02", "revenue": 200},
        {"month": "2026-03", "revenue": 300},
    ]
    facts = compute_facts(cols, rows)
    total = next(f for f in facts if f["kind"] == "total")
    assert total["value"] == "500"


def test_numeric_string_column_detected():
    cols = ["product", "revenue"]
    rows = [{"product": "A", "revenue": "1,000"}, {"product": "B", "revenue": "3,000"}]
    facts = compute_facts(cols, rows)
    assert next(f for f in facts if f["kind"] == "total")["value"] == "4.0K"


def test_negative_total_skips_top_share():
    cols = ["account", "balance"]
    rows = [{"account": "A", "balance": -100}, {"account": "B", "balance": -50}]
    kinds = _kinds(compute_facts(cols, rows))
    assert "top" not in kinds  # share-of-total is meaningless for a negative total
    assert "total" in kinds


def test_non_finite_values_ignored():
    cols = ["month", "revenue"]
    rows = [
        {"month": "2026-01", "revenue": float("nan")},
        {"month": "2026-02", "revenue": 100},
        {"month": "2026-03", "revenue": 300},
    ]
    facts = compute_facts(cols, rows)
    total = next(f for f in facts if f["kind"] == "total")
    assert total["value"] == "400"  # nan excluded
