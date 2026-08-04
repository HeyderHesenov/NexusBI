"""`DecisionMeasurement.data_as_of` — how old a measured number was.

`measured_at` already answers a different question: where the point sits on the
decision's timeline. counterfactual() splits the pre/post history on
`measured_at < baseline_at`, so it cannot ALSO be repointed at the data's age
without moving a baseline taken from an older query into the pre-decision bucket
and changing which scoring method runs. The two questions get two columns.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.ai.types import Text2SQLResult
from app.db.session import AsyncSessionLocal
from app.models.decision import Decision, DecisionMeasurement
from app.models.query_log import QueryLog
from app.models.user import User
from app.services import decision_service, query_service


class FakeCache:
    def __init__(self):
        self.store = {}

    async def get(self, k):
        return self.store.get(k)

    async def set(self, k, v, ttl=300):
        self.store[k] = v


@pytest.fixture
def _stub_sql(monkeypatch):
    async def fake_sql(self, nl, schema, dtype="sqlite", extra_context=""):
        return Text2SQLResult(
            sql="SELECT product_name, SUM(revenue) AS total FROM sales "
                "GROUP BY product_name ORDER BY total DESC LIMIT 5",
            confidence=0.9,
        )

    monkeypatch.setattr(query_service.Text2SQLEngine, "generate_sql", fake_sql)


async def _user(db, email: str) -> User:
    user = User(email=email, hashed_password="x", full_name="T")
    db.add(user)
    await db.flush()
    return user


async def _measurements(db, decision_id: str) -> list[DecisionMeasurement]:
    return list(
        (
            await db.execute(
                select(DecisionMeasurement)
                .where(DecisionMeasurement.decision_id == decision_id)
                .order_by(DecisionMeasurement.measured_at.asc())
            )
        ).scalars()
    )


async def test_baseline_from_a_stored_log_reports_that_log_s_age(_stub_sql):
    """The headline case: capturing a baseline runs NOTHING.

    It lifts the number out of the spawning query's stored snapshot, so a
    decision made now off a query from three hours ago has a three-hour-old
    baseline. Stamping it `now` — which is what `measured_at` must keep saying —
    presented stale data as an instant reading.
    """
    async with AsyncSessionLocal() as db:
        user = await _user(db, "dec-asof-stored@nexusbi.io")
        fetched = datetime.now(timezone.utc) - timedelta(hours=3)
        log = QueryLog(
            user_id=user.id, natural_language="gəlir", generated_sql="SELECT 1",
            result_data={"columns": ["total"], "rows": [{"total": 42}]},
            data_as_of=fetched,
        )
        db.add(log)
        await db.flush()

        d = Decision(
            user_id=user.id, title="Q", insight="i", action="a",
            query_log_id=log.id, metric_column="total",
        )
        db.add(d)
        await db.flush()
        await decision_service._capture_baseline(db, FakeCache(), d)
        await db.flush()

        assert d.baseline_value == 42.0
        points = await _measurements(db, d.id)
        assert len(points) == 1
        # The timeline position is still the decision moment...
        assert decision_service.aware(points[0].measured_at) == decision_service.aware(d.baseline_at)
        # ...and the data's age is reported separately, and honestly.
        assert decision_service.aware(points[0].data_as_of) == fetched
        assert decision_service.aware(points[0].data_as_of) < decision_service.aware(points[0].measured_at)


async def test_baseline_at_stays_the_decision_moment(_stub_sql):
    """The rejected alternative, pinned.

    Backdating `baseline_at` (or `measured_at`) to the data's age would drop this
    point below the pre/post boundary counterfactual() uses, silently switching
    scoring methods. `baseline_at` must keep meaning "when the decision was made".
    """
    async with AsyncSessionLocal() as db:
        user = await _user(db, "dec-asof-boundary@nexusbi.io")
        before = datetime.now(timezone.utc)
        log = QueryLog(
            user_id=user.id, natural_language="gəlir", generated_sql="SELECT 1",
            result_data={"columns": ["total"], "rows": [{"total": 7}]},
            data_as_of=datetime.now(timezone.utc) - timedelta(days=2),
        )
        db.add(log)
        await db.flush()

        d = Decision(
            user_id=user.id, title="Q", insight="i", action="a",
            query_log_id=log.id, metric_column="total",
        )
        db.add(d)
        await db.flush()
        await decision_service._capture_baseline(db, FakeCache(), d)
        await db.flush()

        assert before <= decision_service.aware(d.baseline_at) <= datetime.now(timezone.utc)
        points = await _measurements(db, d.id)
        # The point is NOT pre-decision history, despite two-day-old data.
        assert decision_service.aware(points[0].measured_at) >= decision_service.aware(d.baseline_at)


async def test_baseline_without_a_stamp_falls_back_to_the_log_s_write_time(_stub_sql):
    """A legacy log has no fetch stamp, but its own row is still an upper bound.

    Reporting `None` here would lose information we have; reporting `now` would
    invent freshness. created_at is the honest middle.
    """
    async with AsyncSessionLocal() as db:
        user = await _user(db, "dec-asof-legacy@nexusbi.io")
        log = QueryLog(
            user_id=user.id, natural_language="gəlir", generated_sql="SELECT 1",
            result_data={"columns": ["total"], "rows": [{"total": 5}]},
            data_as_of=None,
        )
        db.add(log)
        await db.flush()

        d = Decision(
            user_id=user.id, title="Q", insight="i", action="a",
            query_log_id=log.id, metric_column="total",
        )
        db.add(d)
        await db.flush()
        await decision_service._capture_baseline(db, FakeCache(), d)
        await db.flush()

        points = await _measurements(db, d.id)
        assert points[0].data_as_of is not None
        assert decision_service.aware(points[0].data_as_of) == decision_service.aware(log.created_at)


async def test_re_measure_reports_now_even_though_its_log_is_older(_stub_sql):
    """`_measure` genuinely re-executes, so its number IS fresh.

    It deliberately does not rewrite the log it credits — other readers depend on
    those stored rows — so the log's own stamp stays old. The measurement must
    report its own freshness rather than inherit the log's, or a live re-measure
    would look as stale as the query it reuses.
    """
    async with AsyncSessionLocal() as db:
        user = await _user(db, "dec-asof-remeasure@nexusbi.io")
        stale = datetime.now(timezone.utc) - timedelta(hours=5)
        log = QueryLog(
            user_id=user.id, natural_language="gəlir",
            generated_sql="SELECT SUM(revenue) AS total FROM sales",
            result_data={"columns": ["total"], "rows": [{"total": 1}]},
            data_as_of=stale,
        )
        db.add(log)
        await db.flush()

        d = Decision(
            user_id=user.id, title="Q", insight="i", action="a",
            last_query_log_id=log.id, metric_column="total",
            baseline_value=1.0, baseline_at=stale,
        )
        db.add(d)
        await db.flush()

        before = datetime.now(timezone.utc)
        await decision_service.measure(db, FakeCache(), d, allow_ai_fallback=False)
        await db.flush()

        points = await _measurements(db, d.id)
        assert len(points) == 1
        fresh = decision_service.aware(points[0].data_as_of)
        assert fresh is not None and fresh >= before, "a real re-execution must not inherit the log's age"
        # The log it credits is untouched — that is why the stamp had to travel
        # with the measurement instead of being read back off the log.
        await db.refresh(log)
        assert decision_service.aware(log.data_as_of) == stale
