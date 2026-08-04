"""`QueryLog.data_as_of` — how old the DATA is, not when the row was written.

The metric tree labels every measured leaf with a timestamp. It used to read the
saved query's run stamp, which answers a different question, and two production
paths pull the two apart in OPPOSITE directions: a cache hit is persisted under a
fresh log (rows older than the stamp) and an in-place widget refresh rewrites an
existing log's rows (rows newer than it). A single fudge factor cannot fix both,
so the fetch itself is recorded.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.ai.types import Text2SQLResult
from app.db.session import AsyncSessionLocal
from app.models.dashboard import Dashboard, Widget
from app.models.metric_node import MetricNode
from app.models.query_log import QueryLog
from app.models.saved_query import SavedQuery
from app.models.user import User
from app.services import dashboard_service, metric_tree_service as svc, query_service


class FakeCache:
    """Round-trips through JSON like the real Redis client, so a datetime that is
    not serialised as a string would be caught here rather than in production."""

    def __init__(self):
        self.store = {}

    async def get(self, k):
        return self.store.get(k)

    async def set(self, k, v, ttl=300):
        self.store[k] = json.loads(json.dumps(v, default=str))


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


# ─── Write path: the cache hit ───

async def test_cache_hit_logs_when_the_data_was_fetched_not_when_it_was_served(_stub_sql):
    """The whole point: a repeated question must not re-date its own rows.

    _finalize persists the cached snapshot under a NEW log row. Stamping that row
    with `now` — the obvious implementation — would tell every reader the data is
    fresh when it is up to CACHE_TTL_SECONDS old.
    """
    cache = FakeCache()
    async with AsyncSessionLocal() as db:
        user = await _user(db, "asof-cache@nexusbi.io")

        first = await query_service.process_nl_query("eyni sual", None, user.id, db, cache)
        second = await query_service.process_nl_query("eyni sual", None, user.id, db, cache)

        assert first.from_cache is False and second.from_cache is True
        assert first.query_log_id != second.query_log_id  # a genuinely new row

        logs = {
            log.id: log
            for log in (
                await db.execute(
                    select(QueryLog).where(
                        QueryLog.id.in_([first.query_log_id, second.query_log_id])
                    )
                )
            ).scalars()
        }
        fetched = logs[first.query_log_id].data_as_of
        assert fetched is not None
        # The served row carries the ORIGINAL fetch, not the moment it was served.
        assert logs[second.query_log_id].data_as_of == fetched


async def test_fetch_stamp_survives_cache_serialisation(_stub_sql):
    """It travels as a string through Redis, so it must come back as an instant.

    A datetime handed to json.dumps(default=str) round-trips to a string that
    silently compares False against every datetime — the column would end up NULL
    and readers would fall back to the run stamp without anything failing.
    """
    cache = FakeCache()
    async with AsyncSessionLocal() as db:
        user = await _user(db, "asof-serial@nexusbi.io")
        await query_service.process_nl_query("serialleşmə sualı", None, user.id, db, cache)

    payload = next(iter(cache.store.values()))
    assert isinstance(payload["fetched_at"], str)
    from app.core.timeutil import to_instant

    assert to_instant(payload["fetched_at"]) is not None


# ─── Write path: the in-place widget refresh ───

async def test_widget_refresh_moves_the_data_stamp_but_not_created_at(_stub_sql):
    """This path really re-executes, but it REUSES the log row.

    created_at still points at the original run, so without moving a stamp the
    rows change underneath anything reporting the number's age.
    """
    async with AsyncSessionLocal() as db:
        user = await _user(db, "asof-widget@nexusbi.io")
        result = await query_service.process_nl_query(
            "widget sualı", None, user.id, db, FakeCache()
        )
        dash = Dashboard(user_id=user.id, name="D")
        db.add(dash)
        await db.flush()
        widget = Widget(dashboard_id=dash.id, query_log_id=result.query_log_id)
        db.add(widget)
        await db.flush()

        log = await db.get(QueryLog, result.query_log_id)
        # Backdate both stamps so the refresh has something to move.
        old = datetime.now(timezone.utc) - timedelta(hours=3)
        log.data_as_of = old
        await db.flush()
        created_before = log.created_at

        chart = await dashboard_service.refresh_widget_data(
            db, widget, user.id, cache=FakeCache(), audience_ids={user.id}
        )
        assert chart is not None

        await db.refresh(log)
        assert svc.aware(log.data_as_of) > svc.aware(old)
        assert log.created_at == created_before  # the row itself did not move


# ─── Read path ───

def _leaf(*, last_run_at, data_as_of):
    """A query-bound leaf with hand-placed stamps — resolve_leaf is pure."""
    sq = SavedQuery(
        id="sq-1", user_id="u-1", name="Satış", nl_query="satış",
        last_run_at=last_run_at, last_query_log_id="log-1",
    )
    log = QueryLog(
        id="log-1", user_id="u-1", natural_language="satış", generated_sql="SELECT 1",
        result_data={"columns": ["total"], "rows": [{"total": 7}]},
        data_as_of=data_as_of,
    )
    node = MetricNode(
        id="n-1", user_id="u-1", name="Satış", source_kind=svc.SOURCE_QUERY,
        saved_query_id="sq-1", value_column="total", agg="sum",
    )
    return svc.resolve_leaf(node, {"sq-1": sq}, {"log-1": log})


def test_leaf_reports_the_data_age_not_the_run_age():
    """The user-visible claim. A cache hit makes run > data; the leaf must say data."""
    run_at = datetime(2026, 8, 4, 12, 0, tzinfo=timezone.utc)
    fetched = run_at - timedelta(minutes=4)  # inside CACHE_TTL_SECONDS

    leaf = _leaf(last_run_at=run_at, data_as_of=fetched)

    assert leaf.value == 7.0
    assert leaf.provenance == svc.MEASURED
    assert leaf.measured_at == fetched
    assert leaf.measured_at < run_at


def test_legacy_row_without_a_stamp_falls_back_to_the_run():
    """Rows written before the column existed are NULL and are not backfilled.

    Falling back is what this line did before, so an old row keeps its old answer
    instead of losing its timestamp entirely.
    """
    run_at = datetime(2026, 8, 4, 12, 0, tzinfo=timezone.utc)

    leaf = _leaf(last_run_at=run_at, data_as_of=None)

    assert leaf.provenance == svc.MEASURED
    assert leaf.measured_at == run_at
