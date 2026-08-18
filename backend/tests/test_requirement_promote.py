"""Promoting an extracted KPI into a tracked Decision.

This is the hop that closes "tələb → nəticə": the KPI's analytic question becomes
the decision's metric query, the confirmed number becomes predicted_value, and
`_compute_impact_status` then answers whether the requirement held.

The link itself lives in the KPI's JSON dict, exactly as ba_service.promote does
it for BA actions — and the first test here is the one that pattern has never had.
"""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import func, select

from app.ai import requirements
from app.ai.types import ChartConfig, Text2SQLResult
from app.db.session import AsyncSessionLocal
from app.models.decision import Decision
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
