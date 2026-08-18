"""Promoting an extracted KPI into a tracked Decision.

This is the hop that closes "tələb → nəticə": the KPI's analytic question becomes
the decision's metric query, the confirmed number becomes predicted_value, and
`_compute_impact_status` then answers whether the requirement held.

The link itself lives in the KPI's JSON dict, exactly as ba_service.promote does
it for BA actions — and the first test here is the one that pattern has never had.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select

from app.ai import requirements
from app.ai.types import ChartConfig, Text2SQLResult
from app.db.session import AsyncSessionLocal
from app.models.decision import Decision, DecisionMeasurement
from app.models.requirement import RequirementDoc
from app.services import decision_service, query_service


@pytest.fixture(autouse=True)
def _mock_ai(monkeypatch):
    async def fake_sql(self, nl, schema, dtype="sqlite", extra_context=""):
        return Text2SQLResult(
            sql="SELECT product_name, SUM(revenue) AS total FROM sales "
                "GROUP BY product_name ORDER BY total DESC LIMIT 5",
            explanation="d", confidence=0.9,
        )

    async def fake_chart(columns, data, nl):
        return ChartConfig(chart_type="bar", x_axis="product_name", y_axis="total")

    async def fake_insight(data, nl, chart_type=""):
        return "ok"

    async def fake_chat_json(system, user, **kw):
        return {
            "kpis": [
                {"name": "Çıxma", "question": "Çıxma faizi nədir?", "requirement_ref": "R1"},
                {"name": "Gəlir", "question": "Aylıq gəlir nədir?", "requirement_ref": "R2"},
            ]
        }

    monkeypatch.setattr(query_service.Text2SQLEngine, "generate_sql", fake_sql)
    monkeypatch.setattr(query_service, "select_chart_type", fake_chart)
    monkeypatch.setattr(query_service, "generate_insight", fake_insight)
    monkeypatch.setattr(requirements, "chat_json", fake_chat_json)


async def _extract(client, auth) -> str:
    resp = await client.post(
        "/api/v1/requirements/extract",
        json={"text": "Çıxma faizi azalmalıdır. Aylıq gəlir artmalıdır."},
        headers=auth,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


async def _promote(client, auth, doc_id: str, **body):
    payload = {"kpi_index": 0, "target_value": 10.0, **body}
    return await client.post(
        f"/api/v1/requirements/{doc_id}/promote", json=payload, headers=auth
    )


async def _second_user(client) -> dict[str, str]:
    resp = await client.post(
        "/api/v1/auth/register",
        json={"email": "other@nexusbi.io", "password": "pw1234", "full_name": "Other"},
    )
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


# ─── the link ───

async def test_the_link_survives_the_session(client, auth):
    """Read the link back through a FRESH session, not the one that wrote it.

    `extracted_kpis` is a plain JSON column, so SQLAlchemy never sees nested
    in-place mutation. Assigning kpis[i]["decision_id"] would emit no UPDATE at
    all: the request that promoted would still answer correctly from its own
    identity map, and only the NEXT request would discover the link was never
    stored — at which point promoting again silently forks a second decision.
    """
    doc_id = await _extract(client, auth)
    resp = await _promote(client, auth, doc_id)
    assert resp.status_code == 201, resp.text
    decision_id = resp.json()["decision"]["id"]

    async with AsyncSessionLocal() as fresh:
        doc = await fresh.get(RequirementDoc, doc_id)
        assert doc.extracted_kpis[0]["decision_id"] == decision_id
        # and the untouched sibling is still untouched
        assert "decision_id" not in doc.extracted_kpis[1]


async def test_promoting_twice_returns_the_same_decision(client, auth):
    """Two separate HTTP requests, so the second genuinely re-reads the document."""
    doc_id = await _extract(client, auth)
    first = await _promote(client, auth, doc_id)
    second = await _promote(client, auth, doc_id, target_value=999.0)

    assert first.status_code == 201, first.text
    assert second.status_code == 201, second.text
    assert first.json()["decision"]["id"] == second.json()["decision"]["id"]
    # The second call did not re-target the existing decision either.
    assert second.json()["decision"]["predicted_value"] == 10.0

    async with AsyncSessionLocal() as fresh:
        count = await fresh.scalar(select(func.count()).select_from(Decision))
        assert count == 1, "a double promote must not fork the loop"


async def test_a_deleted_decision_can_be_promoted_again(client, auth):
    doc_id = await _extract(client, auth)
    first = await _promote(client, auth, doc_id)
    old_id = first.json()["decision"]["id"]

    dropped = await client.delete(f"/api/v1/decisions/{old_id}", headers=auth)
    assert dropped.status_code == 204, dropped.text

    again = await _promote(client, auth, doc_id)
    assert again.status_code == 201, again.text
    assert again.json()["decision"]["id"] != old_id, "the stale link must not resurrect"


# ─── the criterion ───

async def test_direction_is_stored_and_decides_the_verdict(client, auth):
    """The fixture is chosen so that INFERRING the direction gives a DIFFERENT answer.

    `_resolved_direction` falls back to `predicted_value >= baseline_value`, so
    with an ordinary target (20) above an ordinary baseline (10) the inferred and
    explicit directions agree and dropping predicted_direction changes nothing —
    the test would pass while the field went unstored.

    With baseline == predicted == 5 and a realized 4 ("çıxma 5%-i keçməməlidir"),
    explicit "decrease" reads achieved while the inference reads increase, and
    therefore regressed. Same numbers, opposite verdicts.
    """
    doc_id = await _extract(client, auth)
    resp = await _promote(client, auth, doc_id, target_value=5.0, direction="decrease")
    assert resp.status_code == 201, resp.text
    assert resp.json()["decision"]["predicted_direction"] == "decrease"

    async with AsyncSessionLocal() as fresh:
        d = await fresh.get(Decision, resp.json()["decision"]["id"])
        d.baseline_value, d.realized_value = 5.0, 4.0
        assert decision_service._compute_impact_status(d) == "achieved"

        # Control: the identical numbers with no stored direction.
        d.predicted_direction = None
        assert decision_service._compute_impact_status(d) == "regressed"


async def test_zero_is_a_real_target(client, auth):
    """0.0 is falsy, so any truthiness check on the path drops a real criterion."""
    doc_id = await _extract(client, auth)
    resp = await _promote(client, auth, doc_id, target_value=0.0, direction="decrease")
    assert resp.status_code == 201, resp.text
    assert resp.json()["decision"]["predicted_value"] == 0.0

    async with AsyncSessionLocal() as fresh:
        d = await fresh.get(Decision, resp.json()["decision"]["id"])
        assert d.predicted_value == 0.0, "a 0 target must reach the DB as 0, not NULL"
        d.baseline_value, d.realized_value = 5.0, 0.0
        assert decision_service._compute_impact_status(d) == "achieved"


async def test_a_target_is_required(client, auth):
    """Without predicted_value, `achieved` is unreachable — so it is not optional."""
    doc_id = await _extract(client, auth)
    resp = await client.post(
        f"/api/v1/requirements/{doc_id}/promote",
        json={"kpi_index": 0},
        headers=auth,
    )
    assert resp.status_code == 422, resp.text


async def test_the_kpi_question_becomes_the_metric_query(client, auth):
    doc_id = await _extract(client, auth)
    resp = await _promote(client, auth, doc_id, kpi_index=1)
    assert resp.status_code == 201, resp.text
    assert resp.json()["decision"]["metric_query"] == "Aylıq gəlir nədir?"
    # Cadence stays off: a baseline that failed leaves last_query_log_id null and
    # a scheduled tick would then measure nothing, forever, while looking active.
    assert resp.json()["decision"]["measure_cadence"] == "off"


# ─── ownership ───

async def test_another_users_document_is_not_found(client, auth):
    doc_id = await _extract(client, auth)
    other = await _second_user(client)

    resp = await _promote(client, other, doc_id)
    assert resp.status_code == 404, resp.text

    async with AsyncSessionLocal() as fresh:
        count = await fresh.scalar(select(func.count()).select_from(Decision))
        assert count == 0


async def test_an_unknown_kpi_index_is_not_found(client, auth):
    doc_id = await _extract(client, auth)
    resp = await _promote(client, auth, doc_id, kpi_index=99)
    assert resp.status_code == 404, resp.text


async def test_an_unusable_datasource_fails_loudly(client, auth):
    """Not silently: _capture_baseline swallows a failed metric run, so without
    the pre-check this returns 201 and a KPI that can never be measured."""
    doc_id = await _extract(client, auth)
    resp = await _promote(client, auth, doc_id, datasource_id=str(uuid.uuid4()))
    assert resp.status_code == 404, resp.text

    async with AsyncSessionLocal() as fresh:
        count = await fresh.scalar(select(func.count()).select_from(Decision))
        assert count == 0, "a rejected promote must not leave a decision behind"


# ─── the outcome, and how old the number is ───

def _at(hours: int) -> datetime:
    return datetime(2026, 1, 10, 12, 0, tzinfo=timezone.utc) + timedelta(hours=hours)


async def _promoted_decision(client, auth) -> tuple[str, str]:
    doc_id = await _extract(client, auth)
    resp = await _promote(client, auth, doc_id, target_value=20.0, direction="increase")
    assert resp.status_code == 201, resp.text
    return doc_id, resp.json()["decision"]["id"]


async def _rewrite_measurements(decision_id: str, points: list[tuple[int, int | None]]):
    """Replace a decision's trajectory with (measured_at, data_as_of) hour offsets."""
    async with AsyncSessionLocal() as db:
        for m in (
            await db.execute(
                select(DecisionMeasurement).where(
                    DecisionMeasurement.decision_id == decision_id
                )
            )
        ).scalars():
            await db.delete(m)
        for measured, as_of in points:
            db.add(
                DecisionMeasurement(
                    decision_id=decision_id,
                    value=1.0,
                    measured_at=_at(measured),
                    data_as_of=None if as_of is None else _at(as_of),
                )
            )
        await db.commit()


async def test_the_outcome_reports_the_latest_measurement(client, auth):
    doc_id, decision_id = await _promoted_decision(client, auth)
    # Baseline four hours stale, then a genuinely fresh re-measure. Inserted
    # oldest-last so that "whatever the DB returns first" is the WRONG answer.
    await _rewrite_measurements(decision_id, [(0, 0), (-1, -4)])

    body = (await client.get("/api/v1/requirements", headers=auth)).json()
    outcome = body[0]["kpis"][0]["outcome"]
    assert outcome["decision_id"] == decision_id
    assert outcome["measured_at"].startswith("2026-01-10T12:00")
    assert outcome["data_as_of"].startswith("2026-01-10T12:00")


async def test_a_stale_number_is_not_reported_as_fresh(client, auth):
    """The single measurement was TAKEN now but describes four-hour-old data."""
    doc_id, decision_id = await _promoted_decision(client, auth)
    await _rewrite_measurements(decision_id, [(0, -4)])

    outcome = (
        await client.get(f"/api/v1/requirements/{doc_id}", headers=auth)
    ).json()["kpis"][0]["outcome"]
    assert outcome["measured_at"].startswith("2026-01-10T12:00")
    assert outcome["data_as_of"].startswith("2026-01-10T08:00"), (
        "the age of the NUMBER must not be replaced by the time it was taken"
    )


async def test_an_unknown_age_stays_unknown(client, auth):
    doc_id, decision_id = await _promoted_decision(client, auth)
    await _rewrite_measurements(decision_id, [(0, None)])

    outcome = (
        await client.get(f"/api/v1/requirements/{doc_id}", headers=auth)
    ).json()["kpis"][0]["outcome"]
    assert outcome["measured_at"] is not None
    assert outcome["data_as_of"] is None, "unknown must not be rounded up to 'now'"


async def test_an_unpromoted_kpi_has_no_outcome(client, auth):
    doc_id, _ = await _promoted_decision(client, auth)
    kpis = (await client.get(f"/api/v1/requirements/{doc_id}", headers=auth)).json()["kpis"]
    assert kpis[0]["outcome"] is not None
    assert kpis[1]["outcome"] is None
    assert kpis[1]["decision_id"] is None


async def test_another_users_decision_is_never_rendered(client, auth):
    """A document carrying someone else's decision id must show nothing at all."""
    doc_id, decision_id = await _promoted_decision(client, auth)
    other = await _second_user(client)
    other_doc_id = await _extract(client, other)

    # Hand-write user A's decision id into user B's document.
    async with AsyncSessionLocal() as db:
        doc = await db.get(RequirementDoc, other_doc_id)
        kpis = list(doc.extracted_kpis)
        kpis[0] = {**kpis[0], "decision_id": decision_id}
        doc.extracted_kpis = kpis
        await db.commit()

    resp = await client.get(f"/api/v1/requirements/{other_doc_id}", headers=other)
    assert resp.status_code == 200, resp.text
    assert resp.json()["kpis"][0]["outcome"] is None
    assert "20.0" not in resp.text and '"predicted_value":20' not in resp.text


async def test_listing_does_not_grow_a_query_per_document(client, auth):
    """Five documents, three promoted KPIs each — still a fixed number of SELECTs."""
    from sqlalchemy import event
    from sqlalchemy.engine import Engine

    for _ in range(5):
        doc_id = await _extract(client, auth)
        for i in (0, 1):
            assert (await _promote(client, auth, doc_id, kpi_index=i)).status_code == 201

    seen: list[str] = []

    def record(conn, cursor, statement, params, context, executemany):
        if statement.lstrip().upper().startswith("SELECT"):
            seen.append(statement)

    # Listen on the Engine CLASS, not on app.db.session.engine: conftest builds
    # its own engine and overrides get_db, so a listener bound to the app's
    # engine records nothing and the budget below passes on an empty list.
    event.listen(Engine, "before_cursor_execute", record)
    try:
        resp = await client.get("/api/v1/requirements", headers=auth)
    finally:
        event.remove(Engine, "before_cursor_execute", record)

    assert resp.status_code == 200, resp.text
    assert len(resp.json()) == 5
    # Positive control. Without it an empty `seen` satisfies any ceiling, which
    # is precisely how this test passed while measuring nothing at all.
    assert seen, "no SELECT was observed — the listener is attached to the wrong engine"
    # A literal, not len(docs)+k: a budget expressed in terms of the thing it
    # bounds cannot detect the loop moving inside the per-document iteration.
    assert len(seen) <= 4, f"{len(seen)} SELECTs for one list: {seen}"
