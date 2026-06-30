"""Decision CRUD + Decision Intelligence Loop (baseline → measure → ROI)."""
from __future__ import annotations

import pytest
from httpx import AsyncClient

from app.ai.types import ChartConfig, Text2SQLResult
from app.services import decision_service, query_service


@pytest.fixture(autouse=True)
def _mock_ai(monkeypatch):
    async def fake_sql(self, nl, schema, dtype="sqlite", extra_context=""):
        return Text2SQLResult(
            sql="SELECT product_name, SUM(revenue) AS total FROM sales "
                "GROUP BY product_name ORDER BY total DESC LIMIT 5",
            explanation="demo", confidence=0.9, warnings=[],
        )

    async def fake_chart(columns, data, nl):
        return ChartConfig(chart_type="bar", x_axis="product_name", y_axis="total")

    async def fake_insight(data, nl, chart_type=""):
        return "demo insight"

    monkeypatch.setattr(query_service.Text2SQLEngine, "generate_sql", fake_sql)
    monkeypatch.setattr(query_service, "select_chart_type", fake_chart)
    monkeypatch.setattr(query_service, "generate_insight", fake_insight)


def test_extract_scalar_shapes():
    assert decision_service.extract_scalar([], "x") is None
    assert decision_service.extract_scalar([{"total": 10}], "total") == 10.0
    # Multiple rows on the chosen column → sum (total-style measure).
    assert decision_service.extract_scalar([{"v": 3}, {"v": 4}], "v") == 7.0
    # Unknown column falls back to the first numeric column.
    assert decision_service.extract_scalar([{"name": "a", "n": 5}], "missing") == 5.0
    assert decision_service.extract_scalar([{"name": "a"}]) is None


async def test_decision_lifecycle(client: AsyncClient, auth: dict):
    created = await client.post(
        "/api/v1/decisions/",
        json={"title": "Qərbdə düşüş", "insight": "Gəlir 12% düşdü", "action": "Reklam artır"},
        headers=auth,
    )
    assert created.status_code == 201, created.text
    did = created.json()["id"]
    assert created.json()["status"] == "open"
    assert created.json()["impact_status"] == "pending"

    listed = await client.get("/api/v1/decisions/", headers=auth)
    assert any(d["id"] == did for d in listed.json())

    upd = await client.put(
        f"/api/v1/decisions/{did}",
        json={"status": "done", "outcome": "Gəlir bərpa olundu"},
        headers=auth,
    )
    assert upd.json()["status"] == "done"
    assert upd.json()["outcome"] == "Gəlir bərpa olundu"

    assert (await client.delete(f"/api/v1/decisions/{did}", headers=auth)).status_code == 204


async def _run_query(client: AsyncClient, auth: dict) -> str:
    resp = await client.post(
        "/api/v1/query/ask",
        json={"nl_query": "Ən çox satan 5 məhsul", "datasource_id": None},
        headers=auth,
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["query_log_id"]


async def test_decision_loop_baseline_measure_roi(client: AsyncClient, auth: dict):
    qlog = await _run_query(client, auth)
    created = await client.post(
        "/api/v1/decisions/",
        json={
            "title": "Satışı artır", "insight": "Top məhsullar", "action": "Promo",
            "query_log_id": qlog, "metric_column": "total",
            "predicted_value": 10_000_000, "predicted_direction": "increase",
            "measure_cadence": "off",
        },
        headers=auth,
    )
    assert created.status_code == 201, created.text
    body = created.json()
    did = body["id"]
    # Baseline captured straight from the spawning query (no re-run).
    assert body["baseline_value"] is not None
    assert body["impact_status"] == "pending"  # no realized value yet

    measured = await client.post(f"/api/v1/decisions/{did}/measure", headers=auth)
    assert measured.status_code == 200, measured.text
    roi = measured.json()
    assert roi["realized_value"] is not None
    assert roi["impact_status"] in {"pending", "on_track", "achieved", "regressed", "missed"}

    traj = await client.get(f"/api/v1/decisions/{did}/trajectory", headers=auth)
    assert traj.status_code == 200
    assert len(traj.json()) == 2  # baseline + one measurement

    acc = await client.get("/api/v1/decisions/accuracy", headers=auth)
    assert acc.status_code == 200
    assert acc.json()["total_measured"] == 1


def test_impact_status_math():
    """Status reflects movement vs the predicted direction/target."""
    from app.models.decision import Decision

    def status(baseline, realized, predicted, direction, status_="open"):
        d = Decision(
            user_id="u", title="t", baseline_value=baseline, realized_value=realized,
            predicted_value=predicted, predicted_direction=direction, status=status_,
        )
        return decision_service._compute_impact_status(d)

    assert status(100, 80, 150, "increase") == "regressed"   # dropped, wanted up
    assert status(100, 160, 150, "increase") == "achieved"   # hit the target
    assert status(100, 120, 150, "increase") == "on_track"   # moving, not there yet
    assert status(100, 70, 50, "decrease") == "on_track"     # falling toward target
    assert status(100, 70, 50, "decrease", "done") == "missed"  # closed without hitting
    assert status(None, 70, 50, "decrease") == "pending"     # no baseline yet


async def test_delete_clears_measurements(client: AsyncClient, auth: dict):
    """Deleting a tracked decision must not orphan its measurement rows."""
    from sqlalchemy import func, select

    from app.db.session import AsyncSessionLocal
    from app.models.decision import DecisionMeasurement

    qlog = await _run_query(client, auth)
    created = await client.post(
        "/api/v1/decisions/",
        json={"title": "Sil", "action": "x", "query_log_id": qlog, "metric_column": "total"},
        headers=auth,
    )
    did = created.json()["id"]
    await client.post(f"/api/v1/decisions/{did}/measure", headers=auth)

    assert (await client.delete(f"/api/v1/decisions/{did}", headers=auth)).status_code == 204
    async with AsyncSessionLocal() as db:
        cnt = (
            await db.execute(
                select(func.count())
                .select_from(DecisionMeasurement)
                .where(DecisionMeasurement.decision_id == did)
            )
        ).scalar()
    assert cnt == 0


async def test_decisions_require_auth(client: AsyncClient):
    assert (await client.get("/api/v1/decisions/")).status_code == 401
