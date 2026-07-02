"""Cohort retention + funnel — deterministic analytics over demo events."""
from __future__ import annotations

from httpx import AsyncClient

from app.db import demo_data
from app.services import cohort_service


def test_funnel_counts_are_exact():
    data = cohort_service.funnel()
    by_name = {s["name"]: s for s in data["steps"]}
    assert [s["name"] for s in data["steps"]] == ["visit", "signup", "trial", "purchase"]
    assert by_name["visit"]["count"] == 60
    assert by_name["signup"]["count"] == 45
    assert by_name["trial"]["count"] == 30
    assert by_name["purchase"]["count"] == 20
    assert by_name["visit"]["pct_of_first"] == 100.0
    assert by_name["purchase"]["pct_of_first"] == round(20 / 60 * 100, 1)
    assert by_name["signup"]["drop_pct"] == 25.0  # 60 → 45


def test_retention_matrix_shape_and_diagonal():
    data = cohort_service.retention()
    assert len(data["cohorts"]) == 12  # one cohort per 2024 month
    assert data["sizes"] == [5] * 12  # 60 customers / 12 months
    assert data["offsets"][0] == 0
    for row in data["cells"]:
        assert row[0] is not None and row[0]["pct"] == 100.0  # offset 0 = full cohort


def test_retention_january_cohort_steps_down():
    """Seed rule: each 5-customer cohort keeps 5/4/3/2/1 members at offsets 0..4."""
    data = cohort_service.retention()
    jan = data["cells"][0]
    assert [c["count"] for c in jan[:5]] == [5, 4, 3, 2, 1]
    assert [c["pct"] for c in jan[:5]] == [100.0, 80.0, 60.0, 40.0, 20.0]
    assert all(c is not None and c["count"] == 0 for c in jan[5:])  # in-range, inactive


def test_retention_cells_beyond_calendar_are_none():
    data = cohort_service.retention()
    december = data["cells"][-1]
    assert december[0] is not None  # own month is always known
    assert all(cell is None for cell in december[1:])  # 2025 doesn't exist in the seed


def test_retention_monotone_within_range():
    data = cohort_service.retention()
    for row in data["cells"]:
        counts = [c["count"] for c in row if c is not None]
        assert all(a >= b for a, b in zip(counts, counts[1:]))


def test_counts_ignore_live_revenue_factors():
    """Event counts must be stable while the live feed mutates revenue."""
    before = cohort_service.funnel()
    original = demo_data.current_live_factors()
    try:
        demo_data.set_live_factors({cat: 1.7 for cat in original})
        after = cohort_service.funnel()
    finally:
        demo_data.set_live_factors(original)
    assert before == after


async def test_endpoints_require_auth(client: AsyncClient):
    assert (await client.get("/api/v1/cohort/retention")).status_code == 401
    assert (await client.get("/api/v1/cohort/funnel")).status_code == 401


async def test_endpoints_return_payload(client: AsyncClient, auth: dict):
    r = await client.get("/api/v1/cohort/retention", headers=auth)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["cohorts"] and body["cells"]

    f = await client.get("/api/v1/cohort/funnel", headers=auth)
    assert f.status_code == 200, f.text
    assert len(f.json()["steps"]) == 4


def test_snapshot_failure_raises_not_empty(monkeypatch):
    """A failed events query must surface as an error, not an empty dataset."""
    import pytest

    from app.core.exceptions import InvalidSQLError

    monkeypatch.setattr(
        "app.services.cohort_service.execute_demo_snapshot", lambda sqls: [None]
    )
    with pytest.raises(InvalidSQLError):
        cohort_service.retention()
    with pytest.raises(InvalidSQLError):
        cohort_service.funnel()


def test_drop_pct_clamped_for_odd_data(monkeypatch):
    """A step larger than its predecessor yields 0.0 drop, never a negative."""
    rows = [
        {"event_type": "visit", "customers": 10},
        {"event_type": "signup", "customers": 15},  # grows — odd but possible data
        {"event_type": "trial", "customers": 5},
        {"event_type": "purchase", "customers": 2},
    ]
    monkeypatch.setattr(
        "app.services.cohort_service.execute_demo_snapshot", lambda sqls: [rows]
    )
    steps = cohort_service.funnel()["steps"]
    assert steps[1]["drop_pct"] == 0.0  # clamped, not -50.0
    assert steps[2]["drop_pct"] > 0


def test_rule_based_fallback_covers_events():
    """Offline NL→SQL routes event questions to the events table."""
    from app.ai.rule_based_sql import generate_sql_fallback

    monthly = generate_sql_fallback("signup hadisələri ay üzrə").sql.lower()
    assert "from events" in monthly and "substr(event_date, 1, 7)" in monthly

    by_type = generate_sql_fallback("event count by type").sql.lower()
    assert "from events" in by_type and "event_type" in by_type

    # Event vocabulary must not hijack unrelated sales questions.
    sales = generate_sql_fallback("kateqoriya üzrə gəlir").sql.lower()
    assert "from sales" in sales
