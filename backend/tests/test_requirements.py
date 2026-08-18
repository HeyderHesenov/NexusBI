"""Requirements → dashboard: KPI extraction (AI + fallback) and build."""
from __future__ import annotations

import json

import pytest

from app.ai import requirements
from app.ai import prompt_templates
from app.ai.types import ChartConfig, Text2SQLResult
from app.schemas.requirement import KpiItem
from app.services import query_service


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

    monkeypatch.setattr(query_service.Text2SQLEngine, "generate_sql", fake_sql)
    monkeypatch.setattr(query_service, "select_chart_type", fake_chart)
    monkeypatch.setattr(query_service, "generate_insight", fake_insight)


# Every prompt constant handed to chat_json as the SYSTEM message, i.e. never
# passed through .format(). Whatever braces are in the source are literally what
# the model reads, so a `{{` escape here is not an escape — it is a JSON example
# that is not JSON. (SQL_REPAIR_SYSTEM_PROMPT is absent on purpose: it genuinely
# is .format()ed at text2sql.py:74, so its doubling is correct.)
_RAW_SYSTEM_PROMPTS = {
    "REQUIREMENTS_PROMPT": prompt_templates.REQUIREMENTS_PROMPT,
    "CHART_SELECTOR_PROMPT": prompt_templates.CHART_SELECTOR_PROMPT,
    "ROOT_CAUSE_PROMPT": prompt_templates.ROOT_CAUSE_PROMPT,
    "DASHBOARD_PLANNER_PROMPT": prompt_templates.DASHBOARD_PLANNER_PROMPT,
    "DATA_PREP_PROMPT": prompt_templates.DATA_PREP_PROMPT,
    "INSIGHT_DIGEST_PROMPT": prompt_templates.INSIGHT_DIGEST_PROMPT,
    "DATA_STORY_PROMPT": prompt_templates.DATA_STORY_PROMPT,
    "SWOT_PROMPT": prompt_templates.SWOT_PROMPT,
    "PORTER_PROMPT": prompt_templates.PORTER_PROMPT,
    "BCG_ADVICE_PROMPT": prompt_templates.BCG_ADVICE_PROMPT,
    "BPMN_PROMPT": prompt_templates.BPMN_PROMPT,
}

# Known broken, and this list may only ever SHRINK. Fixing them changes the model
# input for nine unrelated features, so they are a separate ticket rather than a
# drive-by in a requirements branch — but they must not multiply in the meantime.
_DOUBLED_BRACE_DEBT = {
    "CHART_SELECTOR_PROMPT", "ROOT_CAUSE_PROMPT", "DASHBOARD_PLANNER_PROMPT",
    "DATA_PREP_PROMPT", "INSIGHT_DIGEST_PROMPT", "DATA_STORY_PROMPT",
    "SWOT_PROMPT", "PORTER_PROMPT", "BCG_ADVICE_PROMPT", "BPMN_PROMPT",
}


def test_the_doubled_brace_debt_only_shrinks():
    """A ratchet, not a snapshot: a NEW raw prompt with `{{` fails immediately.

    Set equality rather than a count — a count is satisfied by fixing one prompt
    and breaking another, which is exactly the drift this is here to stop.
    """
    actual = {name for name, text in _RAW_SYSTEM_PROMPTS.items() if "{{" in text}
    assert actual == _DOUBLED_BRACE_DEBT, (
        "doubled-brace debt changed. Removing a name is the goal — delete it from "
        f"_DOUBLED_BRACE_DEBT too. Adding one is a regression. Now: {sorted(actual)}"
    )


@pytest.mark.parametrize(
    "name", sorted(set(_RAW_SYSTEM_PROMPTS) - _DOUBLED_BRACE_DEBT)
)
def test_a_fixed_prompt_ships_a_json_example_that_is_json(name):
    """The system prompt reaches the model UNFORMATTED (`ai/requirements.py:67`
    passes it straight to `chat_json`; only the USER prompt gets `.format()`).

    The key check is deliberate too: an example advertising a key the schema does
    not have teaches the model to emit a field the normalizer then drops.
    """
    _, marker, block = _RAW_SYSTEM_PROMPTS[name].partition("OUTPUT FORMAT (JSON):")
    assert marker, f"{name} lost its OUTPUT FORMAT block — this guard now checks nothing"

    example = json.loads(block)  # doubled braces raise here

    if name == "REQUIREMENTS_PROMPT":
        assert example["kpis"], "the example must show at least one KPI"
        for kpi in example["kpis"]:
            unknown = set(kpi) - set(KpiItem.model_fields)
            assert not unknown, f"prompt advertises keys KpiItem lacks: {sorted(unknown)}"


def test_rule_based_extraction():
    text = "Aylıq gəlir izlənməlidir.\nMüştəri sayı artmalıdır.\nNormal cümlə."
    out = requirements._rule_based(text)
    assert len(out["kpis"]) >= 2
    assert all(k["question"] for k in out["kpis"])


async def test_extraction_normalises_a_sloppy_criterion(client, auth, monkeypatch):
    """The model's proposal reaches the client already coerced, or not at all."""

    async def fake_chat_json(system, user, **kw):
        return {
            "kpis": [
                {"question": "Çıxma faizi nədir?", "target_value": "15%", "direction": "azalma"},
                {"question": "Gəlir nədir?", "target_value": "10-20", "direction": "artsın da azalsın"},
            ]
        }

    monkeypatch.setattr(requirements, "chat_json", fake_chat_json)
    resp = await client.post(
        "/api/v1/requirements/extract",
        json={"text": "Çıxma faizi 15%-ə düşməlidir."},
        headers=auth,
    )
    assert resp.status_code == 201, resp.text
    kpis = resp.json()["kpis"]

    # "15%" is stored as 15, NOT 0.15 — the metric query answers 15 too.
    assert kpis[0]["target_value"] == 15.0
    assert kpis[0]["direction"] == "decrease"
    # A range and an ambiguous phrase both degrade to "no proposal" without
    # costing the KPI itself, which is still extracted and still usable.
    assert kpis[1]["target_value"] is None
    assert kpis[1]["direction"] is None
    assert kpis[1]["question"] == "Gəlir nədir?"


async def test_offline_fallback_proposes_no_criterion(client, auth, monkeypatch):
    """The rule-based path extracts KPIs but never a number.

    Regexing a threshold out of a bullet would fabricate an acceptance criterion
    from text that never stated one — worse than asking the user to type it.
    """

    async def boom(system, user, **kw):
        raise RuntimeError("no AI configured")

    monkeypatch.setattr(requirements, "chat_json", boom)
    resp = await client.post(
        "/api/v1/requirements/extract",
        json={"text": "Aylıq gəlir 15% artmalıdır.\nMüştəri sayı 200 olmalıdır."},
        headers=auth,
    )
    assert resp.status_code == 201, resp.text
    kpis = resp.json()["kpis"]
    assert kpis, "the offline path must still extract the KPIs themselves"
    assert all(k["target_value"] is None for k in kpis)
    assert all(k["direction"] is None for k in kpis)


async def test_extract_endpoint_ai(client, auth, monkeypatch):
    async def fake_chat_json(system, user, **kw):
        return {
            "kpis": [
                {"name": "Gəlir", "question": "Aylıq gəlir trendi?", "rationale": "r", "requirement_ref": "x"}
            ]
        }

    monkeypatch.setattr(requirements, "chat_json", fake_chat_json)
    resp = await client.post(
        "/api/v1/requirements/extract",
        json={"name": "BRD", "text": "Gəlir artımı izlənməlidir."},
        headers=auth,
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["kpis"][0]["question"] == "Aylıq gəlir trendi?"
    assert body["name"] == "BRD"


async def test_extract_falls_back(client, auth, monkeypatch):
    async def boom(system, user, **kw):
        raise RuntimeError("ai down")

    monkeypatch.setattr(requirements, "chat_json", boom)
    resp = await client.post(
        "/api/v1/requirements/extract",
        json={"text": "Aylıq satış sayı izlənməlidir.\nGəlir trendi vacibdir."},
        headers=auth,
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["kpis"]  # rule-based produced something


async def test_extract_then_build(client, auth, monkeypatch):
    async def fake_chat_json(system, user, **kw):
        return {"kpis": [{"name": "Gəlir", "question": "Məhsul üzrə gəlir nədir?"}]}

    monkeypatch.setattr(requirements, "chat_json", fake_chat_json)
    doc = (
        await client.post(
            "/api/v1/requirements/extract",
            json={"text": "Gəlir izlənməlidir."},
            headers=auth,
        )
    ).json()

    resp = await client.post(
        f"/api/v1/requirements/{doc['id']}/build",
        json={"datasource_id": None},
        headers=auth,
    )
    assert resp.status_code == 201, resp.text
    dash = resp.json()
    assert dash["widgets"], "build should produce at least one widget"

    # The doc is now linked to the dashboard.
    docs = (await client.get("/api/v1/requirements", headers=auth)).json()
    assert docs[0]["dashboard_id"] == dash["id"]
