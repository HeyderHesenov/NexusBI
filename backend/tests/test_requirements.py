"""Requirements → dashboard: KPI extraction (AI + fallback) and build."""
from __future__ import annotations

import json
import pathlib
import re

import pytest

from app.ai import requirements
from app.ai import copilot, prompt_templates
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


# ─── the inventory of prompts the model reads VERBATIM ───
#
# Built by REFLECTION, not by hand. The hand-written list was itself the hole:
# TEXT2DAX_SYSTEM_PROMPT sat outside it from the day it was written, so the
# ratchet below promised "a new raw prompt with `{{` fails immediately" while a
# tenth one was already there, unseen. Membership is now opt-OUT — a prompt has
# to be a `.format()` template to escape these guards.
_PLACEHOLDER = re.compile(r"\{[A-Za-z_][A-Za-z0-9_]*\}")
_OUTPUT_MARKER = "OUTPUT FORMAT (JSON):"
# copilot keeps its prompts next to the feature they ARE; the scan below pins
# that no third home appears.
_PROMPT_MODULES = (prompt_templates, copilot)


def _prompt_constants(module: object) -> dict[str, str]:
    return {
        name: value
        for name, value in vars(module).items()
        if name.endswith("_PROMPT") and isinstance(value, str) and not name.startswith("_")
    }


_ALL_PROMPTS = {
    f"{mod.__name__.rsplit('.', 1)[-1]}.{name}": text
    for mod in _PROMPT_MODULES
    for name, text in _prompt_constants(mod).items()
}
# A `{placeholder}` means the string is .format()ed before it is sent, so ITS
# doubled braces are real escapes. Everything else reaches the model as written.
_TEMPLATE_PROMPTS = {n for n, t in _ALL_PROMPTS.items() if _PLACEHOLDER.search(t)}
_RAW_SYSTEM_PROMPTS = {n: t for n, t in _ALL_PROMPTS.items() if n not in _TEMPLATE_PROMPTS}

# Known broken, and this list may only ever SHRINK.
#
# Measured 2026-08-18 with real gpt-4o calls: for these the doubling changes
# NOTHING the user can see, because chat_json sends
# response_format={"type": "json_object"} — the structure is constrained server
# side, and Porter came back with identical keys and force list under both
# prompts (2 runs each). Fixing them is hygiene, not a bug fix, and would alter
# the model input of ten working features at once. BPMN was the exception,
# because there the braces also meant a mermaid SHAPE, and it is fixed: see
# test_the_bpmn_example_draws_decisions_as_rhombuses.
_DOUBLED_BRACE_DEBT = {
    "prompt_templates.CHART_SELECTOR_PROMPT",
    "prompt_templates.ROOT_CAUSE_PROMPT",
    "prompt_templates.DASHBOARD_PLANNER_PROMPT",
    "prompt_templates.DATA_PREP_PROMPT",
    "prompt_templates.INSIGHT_DIGEST_PROMPT",
    "prompt_templates.DATA_STORY_PROMPT",
    "prompt_templates.SWOT_PROMPT",
    "prompt_templates.PORTER_PROMPT",
    "prompt_templates.BCG_ADVICE_PROMPT",
    "prompt_templates.TEXT2DAX_SYSTEM_PROMPT",
}
# Which raw prompts carry a JSON example at all. Pinned, so deleting the block is
# not a way to make the parse guard below stop looking.
_WITH_OUTPUT_BLOCK = _DOUBLED_BRACE_DEBT | {
    "prompt_templates.REQUIREMENTS_PROMPT",
    "prompt_templates.BPMN_PROMPT",
    "copilot.PLAN_PROMPT",
}


def _formats(bare_name: str) -> bool:
    """Does anything in app/ call `.format()` on this constant?

    The lookbehind keeps a shorter name from matching inside a longer one —
    `SYSTEM_PROMPT` inside `TEXT2SQL_SYSTEM_PROMPT`.
    """
    root = pathlib.Path(__file__).resolve().parents[1] / "app"
    call = re.compile(rf"(?<![A-Z0-9_]){bare_name}\.format\(")
    return any(call.search(path.read_text(encoding="utf-8")) for path in root.rglob("*.py"))


def test_every_prompt_in_the_tree_is_in_the_inventory():
    """A prompt these modules cannot see is a prompt no guard here protects.

    Reflection covers the two known homes; this covers the third one nobody has
    written yet. Anchored to the assignment at column 0, so a prompt built inside
    a function is out of scope on purpose — those are per-call strings, not
    constants shipped to the model unchanged.
    """
    root = pathlib.Path(__file__).resolve().parents[1] / "app"
    pattern = re.compile(r"^([A-Z][A-Z0-9_]*_PROMPT)\s*=", re.MULTILINE)
    found = {
        f"{path.stem}.{m.group(1)}"
        for path in root.rglob("*.py")
        for m in pattern.finditer(path.read_text(encoding="utf-8"))
    }
    assert found, "the scan matched nothing — it is checking nothing"
    missing = found - set(_ALL_PROMPTS)
    assert not missing, (
        f"prompts outside the inventory, so outside every guard here: {sorted(missing)}"
    )


@pytest.mark.parametrize("name", sorted(_TEMPLATE_PROMPTS))
def test_a_template_prompt_really_is_formatted(name):
    """The escape hatch has to be earned, not assumed.

    A prompt classified as a template keeps its doubled braces legitimately —
    but only if something actually calls .format() on it. Otherwise the
    classification is an escape hatch that closes itself.
    """
    assert _formats(name.split(".", 1)[1]), (
        f"{name} looks like a template but nothing formats it — then it is RAW"
    )


@pytest.mark.parametrize("name", sorted(_RAW_SYSTEM_PROMPTS))
def test_a_raw_prompt_is_never_formatted(name):
    """The other direction: a raw prompt that IS formatted would 500 on `{Qərar?}`.

    The name boundary in `_formats` is load-bearing right here, not decorative:
    a plain substring search for `SYSTEM_PROMPT.format(` matches
    `TEXT2SQL_SYSTEM_PROMPT.format(` and would accuse copilot's SYSTEM_PROMPT of
    a call it never receives. That exact false positive is what sent me looking
    for a formatting call site that does not exist.
    """
    assert not _formats(name.split(".", 1)[1]), (
        f"{name} is formatted somewhere, so it is not raw — reclassify it"
    )


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


def test_which_raw_prompts_carry_a_json_example_is_pinned():
    actual = {n for n, t in _RAW_SYSTEM_PROMPTS.items() if _OUTPUT_MARKER in t}
    assert actual == _WITH_OUTPUT_BLOCK, (
        "the set of prompts with an OUTPUT FORMAT block changed; deleting one is "
        f"how the parse guard below stops checking. Now: {sorted(actual)}"
    )


@pytest.mark.parametrize("name", sorted(_WITH_OUTPUT_BLOCK - _DOUBLED_BRACE_DEBT))
def test_a_fixed_prompt_ships_a_json_example_that_is_json(name):
    """These reach the model UNFORMATTED (`ai/requirements.py:67` passes the
    system prompt straight to `chat_json`; only the USER prompt gets `.format()`).

    The key check is deliberate too: an example advertising a key the schema does
    not have teaches the model to emit a field the normalizer then drops.
    """
    _, marker, block = _RAW_SYSTEM_PROMPTS[name].partition(_OUTPUT_MARKER)
    assert marker, f"{name} lost its OUTPUT FORMAT block — this guard now checks nothing"

    example = json.loads(block)  # doubled braces raise here

    if name == "prompt_templates.REQUIREMENTS_PROMPT":
        assert example["kpis"], "the example must show at least one KPI"
        for kpi in example["kpis"]:
            unknown = set(kpi) - set(KpiItem.model_fields)
            assert not unknown, f"prompt advertises keys KpiItem lacks: {sorted(unknown)}"


def test_the_bpmn_example_draws_decisions_as_rhombuses():
    """In mermaid `{...}` is the decision rhombus; `{{...}}` is a HEXAGON.

    So BPMN's doubled braces were never only a formatting slip — they also told
    the model to draw every decision with the wrong shape, and it obeyed:
    measured 2026-08-18 with real gpt-4o calls, the doubled example produced
    `C{{Stokda var?}}` in the generated mermaid 3 times out of 3, the un-doubled
    one produced `C{Stokda var?}` 3 out of 3.

    This cannot be folded into the JSON-parse guard above. The mermaid lives
    INSIDE a JSON string, where a doubled brace is still perfectly valid JSON —
    that guard would stay green while every generated diagram drew hexagons.
    """
    prompt = prompt_templates.BPMN_PROMPT
    _, marker, block = prompt.partition(_OUTPUT_MARKER)
    assert marker, "BPMN prompt lost its OUTPUT FORMAT block"
    mermaid = json.loads(block)["mermaid"]

    assert "{{" not in mermaid and "}}" not in mermaid, (
        f"the example draws hexagons, not decisions: {mermaid!r}"
    )
    # Positive control: an example with no decision node at all would satisfy the
    # assertion above while teaching the model nothing about rhombuses.
    assert re.search(r"\w\{[^{}]+\}", mermaid), "the example shows no decision node"

    # The prose must agree with the syntax it demonstrates, or the model is given
    # two different answers. Scoped to the LINE that carries each claim rather
    # than to its wording, so rephrasing the rule does not fail the build — but
    # re-doubling it still does.
    shape_rule = next(ln for ln in prompt.splitlines() if "romb" in ln.lower())
    assert "{{" not in shape_rule and re.search(r"\{[^{}]+\}", shape_rule), (
        f"the rule text names the wrong shape: {shape_rule!r}"
    )
    # `%%{` is what mermaid parses and what sanitize_mermaid rejects; `%%{{` is a
    # token neither of them has ever seen.
    directive_rule = next(ln for ln in prompt.splitlines() if "%%" in ln)
    assert "%%{" in directive_rule and "%%{{" not in directive_rule, (
        f"the forbidden-directive token is not what mermaid parses: {directive_rule!r}"
    )


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
