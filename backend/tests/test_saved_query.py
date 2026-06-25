"""Saved queries + scheduler due-logic."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from httpx import AsyncClient

from app.ai.types import ChartConfig, Text2SQLResult
from app.services import query_service


@pytest.fixture(autouse=True)
def _mock_ai(monkeypatch):
    async def fake_sql(self, nl, schema, dtype="sqlite"):
        return Text2SQLResult(
            sql="SELECT product_name, SUM(revenue) AS total FROM sales "
                "GROUP BY product_name ORDER BY total DESC LIMIT 5",
            confidence=0.9,
        )

    async def fake_chart(columns, data, nl):
        return ChartConfig(chart_type="bar", x_axis="product_name", y_axis="total")

    async def fake_insight(data, nl, chart_type=""):
        return "ok"

    monkeypatch.setattr(query_service.Text2SQLEngine, "generate_sql", fake_sql)
    monkeypatch.setattr(query_service, "select_chart_type", fake_chart)
    monkeypatch.setattr(query_service, "generate_insight", fake_insight)


async def test_saved_query_crud_and_run(client: AsyncClient, auth: dict):
    created = await client.post(
        "/api/v1/saved/",
        json={"name": "Top məhsullar", "nl_query": "ən çox satan", "schedule": "daily"},
        headers=auth,
    )
    assert created.status_code == 201, created.text
    sid = created.json()["id"]
    assert created.json()["schedule"] == "daily"

    listing = await client.get("/api/v1/saved/", headers=auth)
    assert any(s["id"] == sid for s in listing.json())

    run = await client.post(f"/api/v1/saved/{sid}/run", headers=auth)
    assert run.status_code == 200, run.text
    assert len(run.json()["data"]) == 5

    # last_run_at recorded after a run
    after = await client.get("/api/v1/saved/", headers=auth)
    row = next(s for s in after.json() if s["id"] == sid)
    assert row["last_run_at"] is not None
    assert row["last_query_log_id"]

    upd = await client.put(f"/api/v1/saved/{sid}", json={"schedule": "off"}, headers=auth)
    assert upd.json()["schedule"] == "off"

    assert (await client.delete(f"/api/v1/saved/{sid}", headers=auth)).status_code == 204


def test_is_due_logic():
    from app.models.saved_query import SavedQuery
    from app.services import saved_query_service as svc

    now = datetime(2026, 6, 25, 12, 0, tzinfo=timezone.utc)
    off = SavedQuery(schedule="off", last_run_at=None)
    fresh = SavedQuery(schedule="daily", last_run_at=None)
    recent = SavedQuery(schedule="daily", last_run_at=now - timedelta(hours=1))
    stale = SavedQuery(schedule="daily", last_run_at=now - timedelta(days=2))

    assert svc.is_due(off, now) is False
    assert svc.is_due(fresh, now) is True   # never run → due
    assert svc.is_due(recent, now) is False  # ran 1h ago, daily → not due
    assert svc.is_due(stale, now) is True    # ran 2d ago, daily → due


async def test_run_due_executes_scheduled(client: AsyncClient, auth: dict, monkeypatch):
    """run_due runs a due saved query (server-side, no rate limit)."""
    from app.db.session import AsyncSessionLocal
    from app.services import saved_query_service as svc
    from app.services.cache_service import CacheService

    created = await client.post(
        "/api/v1/saved/",
        json={"name": "Cədvəlli", "nl_query": "satışlar", "schedule": "hourly"},
        headers=auth,
    )
    assert created.status_code == 201

    async with AsyncSessionLocal() as db:
        ran = await svc.run_due(db, CacheService(None))
        await db.commit()
    assert ran >= 1
