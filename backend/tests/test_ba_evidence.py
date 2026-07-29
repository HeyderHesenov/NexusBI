"""BA Studio evidence layer: fact pack, the rule → evidence channel, promotion.

The load-bearing claims under test:
  * the pack is DETERMINISTIC across calls (one demo seed, not one per probe);
  * only rules attach evidence — model output never claims to be data-backed;
  * shares are sized against the real grand total, not a top-N slice;
  * BCG over a real source uses the user's numbers, and refuses rather than
    silently falling back to demo data;
  * promoting an action is idempotent ACROSS a session boundary (which is what
    catches nested-JSON mutation not being persisted).
"""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

from httpx import AsyncClient

from app.ai import ba_bcg, ba_evidence, ba_frameworks
from app.core.exceptions import AIGenerationError
from tests.conftest import seed_internal_datasource, seed_sqlite_file

# ─── the rule → evidence channel ───

_FACTS = [
    {"id": "f1", "kind": "trend", "label": "", "value": "-12%", "metric": "revenue", "source": "s"},
    {"id": "f2", "kind": "concentration", "label": "Books", "value": "47%", "metric": "revenue", "source": "s"},
    {"id": "f3", "kind": "anomaly", "label": "", "value": "2", "metric": "revenue", "source": "s"},
    {"id": "f4", "kind": "top", "label": "Books", "value": "1.2K (47%)", "metric": "revenue", "source": "s"},
]


def test_derive_items_attaches_evidence_by_rule():
    out = ba_evidence.derive_items(_FACTS)
    assert [i["text"] for i in out["weaknesses"]] and out["weaknesses"][0]["evidence"] == ["f1"]
    threat_ids = {e for i in out["threats"] for e in i["evidence"]}
    assert threat_ids == {"f2", "f3"}
    assert all(i["derived"] for b in out.values() for i in b)
    # A `top` contributor has no polarity — it stays a chip and yields no bullet.
    assert not any("f4" in i["evidence"] for b in out.values() for i in b)


def test_derive_items_polarity_follows_the_number():
    positive = [{"id": "f1", "kind": "trend", "value": "+18%", "label": "", "metric": "m", "source": "s"}]
    assert ba_evidence.derive_items(positive)["strengths"]
    assert not ba_evidence.derive_items(positive)["weaknesses"]


def test_derive_items_ignores_weak_concentration():
    weak = [{"id": "f1", "kind": "concentration", "value": "12%", "label": "A", "metric": "m", "source": "s"}]
    assert not ba_evidence.derive_items(weak)["threats"]


def test_pct_only_parses_a_leading_percentage():
    assert ba_evidence._pct("+18%") == 18.0
    assert ba_evidence._pct("-12%") == -12.0
    assert ba_evidence._pct("1.2K (47%)") is None  # must not read the share as the value


async def test_model_output_never_claims_evidence():
    # Even if the model volunteers a citation, it is dropped: an unverifiable
    # citation rendered as "grounded" would launder a hallucination.
    fake = {
        "strengths": [{"text": "Güclü marka", "evidence": ["f1", "f2"]}],
        "weaknesses": ["Zəif kanal"],
        "opportunities": [], "threats": [], "advice": "a",
        "actions": [{"text": "Kanalı gücləndir", "impact": 4, "effort": 2,
                     "metric_hint": "aylıq gəlir", "direction": "increase"}],
    }
    with patch.object(ba_frameworks, "chat_json", AsyncMock(return_value=fake)):
        out = await ba_frameworks.swot("kontekst", _FACTS)
    model_items = [i for b in ("strengths", "weaknesses") for i in out[b] if not i["derived"]]
    assert model_items and all(i["evidence"] == [] for i in model_items)
    # Rule-derived bullets are still there, and they DO carry evidence.
    assert any(i["derived"] and i["evidence"] for b in out.values() if isinstance(b, list) for i in b)


# ─── action normalisation ───


async def test_actions_are_clamped_and_coerced():
    fake = {
        "strengths": ["s"], "weaknesses": [], "opportunities": [], "threats": [], "advice": "",
        "actions": [
            {"text": "a", "impact": 99, "effort": -4, "metric_hint": "m", "direction": "sideways"},
            {"text": "b", "impact": "not a number", "effort": None, "direction": "decrease"},
            {"text": "   ", "impact": 3, "effort": 3},  # empty text → dropped
            {"impact": 3},  # no text → dropped
        ],
    }
    with patch.object(ba_frameworks, "chat_json", AsyncMock(return_value=fake)):
        out = await ba_frameworks.swot("kontekst", [])
    by_text = {a["text"]: a for a in out["actions"]}
    assert set(by_text) == {"a", "b"}
    assert by_text["a"]["impact"] == 5 and by_text["a"]["effort"] == 1
    assert by_text["a"]["direction"] == "increase"  # unknown direction coerced
    assert by_text["b"]["impact"] == 3 and by_text["b"]["effort"] == 3  # non-numeric → middling
    assert by_text["b"]["direction"] == "decrease"


async def test_offline_path_still_produces_actions():
    with patch.object(ba_frameworks, "chat_json", AsyncMock(side_effect=AIGenerationError("x"))):
        out = await ba_frameworks.swot("güclü komanda", _FACTS)
    assert out["actions"], "the keyless path must still hand the user something to act on"
    assert all(a["derived"] for a in out["actions"])


async def test_every_framework_closes_the_loop_offline():
    """No framework may render an empty action list on the keyless path.

    Fact-derived actions only fire when the data says something actionable — a
    healthy trend and a spread-out portfolio produce none — so without the
    structural backstop the framework → decision loop would be dead exactly in
    the offline demo. These facts are deliberately benign (positive trend, low
    concentration) to pin that case.
    """
    benign = [
        {"id": "f1", "kind": "trend", "label": "", "value": "+75%", "metric": "revenue", "source": "s"},
        {"id": "f2", "kind": "concentration", "label": "P9", "value": "9%", "metric": "revenue", "source": "s"},
    ]
    assert ba_evidence.derive_actions(benign, "swot") == [], "precondition: no fact-derived actions"

    context = (
        "Güclü komanda var.\nZəif marketinq büdcəsi problemdir.\n"
        "Yeni bazara imkan var.\nRəqib təzyiqi riski artır."
    )
    with patch.object(ba_frameworks, "chat_json", AsyncMock(side_effect=AIGenerationError("x"))):
        for framework in ("swot", "porter", "bpmn"):
            out = await ba_frameworks.GENERATORS[framework](context, benign)
            assert out["actions"], f"{framework} produced no actions offline"
            assert all(a["metric_hint"] == "revenue trendi" for a in out["actions"])

        core = ba_bcg.compute_bcg()
        bcg_out = await ba_frameworks.bcg("portfel", ba_evidence.facts_from_bcg(core), core)
    assert bcg_out["actions"]


async def test_structural_actions_yield_to_a_good_ai_response():
    # The backstop must not dilute AI output — it only fills remaining room.
    ai_actions = [
        {"text": f"AI {i}", "impact": 5, "effort": 1, "direction": "increase"} for i in range(5)
    ]
    fake = {
        "strengths": ["s"], "weaknesses": ["w"], "opportunities": [], "threats": [],
        "advice": "", "actions": ai_actions,
    }
    with patch.object(ba_frameworks, "chat_json", AsyncMock(return_value=fake)):
        out = await ba_frameworks.swot("kontekst", [])
    assert [a["text"] for a in out["actions"]] == [f"AI {i}" for i in range(5)]


def test_actions_never_exceed_the_cap():
    many = [
        {"text": f"a{i}", "impact": 3, "effort": 3, "direction": "increase"} for i in range(20)
    ]
    assert len(ba_frameworks._actions(many)) == ba_frameworks._MAX_ACTIONS


# ─── fact pack over the demo model ───


async def test_fact_pack_probes_share_one_read(client: AsyncClient, auth: dict):
    """Every probe in one generation must see the SAME data.

    The demo model reseeds per ``execute_demo_sql`` call and the live feed
    random-walks revenue between calls, so probes run separately would land on
    different datasets — and the breakdown's top row could then exceed the series
    grand total it is divided by, yielding a share above 100%. A single snapshot
    makes that impossible, so the bound below is what pins the invariant.
    """
    resp = await client.post(
        "/api/v1/ba/generate",
        json={"framework": "swot", "context": "güclü komanda, zəif marketinq"},
        headers=auth,
    )
    assert resp.status_code == 201, resp.text
    pack = resp.json()["content"]["facts"]
    assert pack, "the demo model must yield facts"
    assert [f["id"] for f in pack] == [f"f{i}" for i in range(1, len(pack) + 1)]
    kinds = {f["kind"] for f in pack}
    assert "total" in kinds and "trend" in kinds
    assert all(f.get("source") and f.get("metric") for f in pack)
    for f in pack:
        if f["kind"] == "concentration":
            assert 0 < ba_evidence._pct(f["value"]) <= 100, f


def test_composition_shares_use_the_grand_total_not_the_slice():
    # A truncated breakdown (rows == the probe limit) must size its share against
    # the series total, or every share is overstated.
    rows = [{"d": f"D{i}", "m": 10.0} for i in range(ba_evidence._TOP_N)]
    rows[0]["m"] = 50.0
    facts = ba_evidence.composition_facts("s", "m", ["d", "m"], rows, grand_total=1000.0)
    conc = next(f for f in facts if f["kind"] == "concentration")
    assert conc["value"] == "5%"  # 50 / 1000, not 50 / 140


def test_composition_falls_back_to_own_sum_when_complete():
    # Fewer rows than the limit means the breakdown IS the whole picture.
    rows = [{"d": "A", "m": 50.0}, {"d": "B", "m": 30.0}, {"d": "C", "m": 20.0}]
    facts = ba_evidence.composition_facts("s", "m", ["d", "m"], rows, grand_total=None)
    assert next(f for f in facts if f["kind"] == "concentration")["value"] == "50%"


def test_composition_skips_unknowable_shares():
    # Truncated AND no series total → the share cannot be known, so nothing is claimed.
    rows = [{"d": f"D{i}", "m": 10.0} for i in range(ba_evidence._TOP_N)]
    assert ba_evidence.composition_facts("s", "m", ["d", "m"], rows, grand_total=None) == []


def test_composition_ignores_non_positive_totals():
    rows = [{"d": "A", "m": -5.0}, {"d": "B", "m": -3.0}, {"d": "C", "m": -2.0}]
    assert ba_evidence.composition_facts("s", "m", ["d", "m"], rows, grand_total=None) == []


# ─── API: context guard, evidence on the artifact, real source ───


async def test_generate_requires_context_for_text_frameworks(client: AsyncClient, auth: dict):
    resp = await client.post(
        "/api/v1/ba/generate", json={"framework": "swot", "context": "   "}, headers=auth
    )
    assert resp.status_code == 400, resp.text
    # BCG reads its numbers from the source, so an empty context is fine there.
    ok = await client.post("/api/v1/ba/generate", json={"framework": "bcg"}, headers=auth)
    assert ok.status_code == 201, ok.text


async def test_artifact_carries_its_facts(client: AsyncClient, auth: dict):
    resp = await client.post(
        "/api/v1/ba/generate",
        json={"framework": "swot", "context": "güclü komanda, zəif marketinq"},
        headers=auth,
    )
    assert resp.status_code == 201, resp.text
    content = resp.json()["content"]
    assert content["facts"], "the artifact must persist the numbers it was built from"
    assert resp.json()["datasource_id"] is None


async def test_bcg_over_a_real_source_uses_the_users_numbers(client: AsyncClient, auth: dict):
    conn = seed_sqlite_file(
        """
        CREATE TABLE orders (category TEXT, revenue REAL, order_date TEXT);
        INSERT INTO orders VALUES
          ('Widgets', 100, '2024-01-15'), ('Widgets', 300, '2024-09-15'),
          ('Gadgets', 200, '2024-02-15'), ('Gadgets', 100, '2024-10-15'),
          ('Trinkets',  50, '2024-03-15'), ('Trinkets',  60, '2024-11-15');
        """
    )
    ds_id = await seed_internal_datasource("test@nexusbi.io", "orders-src", conn)
    resp = await client.post(
        "/api/v1/ba/generate",
        json={"framework": "bcg", "datasource_id": ds_id, "context": "portfel"},
        headers=auth,
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    labels = {i["label"] for i in body["content"]["items"]}
    assert labels == {"Widgets", "Gadgets", "Trinkets"}
    assert not labels & {"Books", "Sports", "Electronics"}, "demo categories must not leak in"
    assert body["datasource_id"] == ds_id
    by = {i["label"]: i for i in body["content"]["items"]}
    assert by["Widgets"]["growth_pct"] == 200.0  # 300 vs 100
    assert by["Gadgets"]["growth_pct"] == -50.0  # 100 vs 200


async def test_provenance_survives_deleting_the_source(client: AsyncClient, auth: dict):
    """The source name is snapshotted, not just referenced.

    ``datasource_id`` is ON DELETE SET NULL, so after the source is removed the FK
    alone would make this artifact look demo-built — a lie about where its numbers
    came from, in the one feature that is about provenance.
    """
    conn = seed_sqlite_file(
        "CREATE TABLE orders (category TEXT, revenue REAL, order_date TEXT);"
        "INSERT INTO orders VALUES ('A', 10, '2024-01-15'), ('A', 20, '2024-07-15'),"
        " ('B', 30, '2024-02-15'), ('B', 15, '2024-08-15'),"
        " ('C', 40, '2024-03-15'), ('C', 45, '2024-09-15');"
    )
    ds_id = await seed_internal_datasource("test@nexusbi.io", "prod-orders", conn)
    art = (await client.post(
        "/api/v1/ba/generate",
        json={"framework": "bcg", "datasource_id": ds_id, "context": "portfel"},
        headers=auth,
    )).json()
    assert art["content"]["source_name"] == "prod-orders"

    assert (await client.delete(f"/api/v1/datasource/{ds_id}", headers=auth)).status_code in (
        200, 204,
    )
    after = (await client.get(f"/api/v1/ba/{art['id']}", headers=auth)).json()
    assert after["datasource_id"] is None  # FK nulled, as designed
    assert after["content"]["source_name"] == "prod-orders"  # provenance survives


async def test_demo_artifact_claims_no_source(client: AsyncClient, auth: dict):
    art = (await client.post(
        "/api/v1/ba/generate", json={"framework": "bcg", "context": "portfel"}, headers=auth
    )).json()
    # Absent (not "Demo") so the frontend labels it from the null datasource_id.
    assert "source_name" not in art["content"]


async def test_bcg_refuses_an_unprofilable_source(client: AsyncClient, auth: dict):
    # No temporal column → no half-over-half growth → no matrix. Refusing is the
    # point: drawing demo revenue under the user's source name would be a lie.
    conn = seed_sqlite_file(
        "CREATE TABLE flat (category TEXT, revenue REAL);"
        "INSERT INTO flat VALUES ('A', 10), ('B', 20), ('C', 30);"
    )
    ds_id = await seed_internal_datasource("test@nexusbi.io", "flat-src", conn)
    resp = await client.post(
        "/api/v1/ba/generate",
        json={"framework": "bcg", "datasource_id": ds_id, "context": "portfel"},
        headers=auth,
    )
    assert resp.status_code == 400, resp.text
    assert "Books" not in resp.text and "Sports" not in resp.text


# ─── promotion ───


async def _artifact_with_action(client: AsyncClient, auth: dict) -> dict:
    resp = await client.post(
        "/api/v1/ba/generate",
        json={"framework": "bcg", "title": "Portfel", "context": "portfel"},
        headers=auth,
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["content"]["actions"], "BCG must always derive actions from its matrix"
    return body


async def test_promote_creates_a_tracked_decision(client: AsyncClient, auth: dict):
    art = await _artifact_with_action(client, auth)
    resp = await client.post(
        f"/api/v1/ba/{art['id']}/promote", json={"action_index": 0}, headers=auth
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    action = art["content"]["actions"][0]
    assert body["decision"]["title"] == action["text"][:255]
    assert body["decision"]["action"] == action["text"]
    assert body["decision"]["measure_cadence"] == "off"
    # The artifact comes back already citing the decision — the client never has
    # to synthesise the link it just caused.
    assert body["artifact"]["content"]["actions"][0]["decision_id"] == body["decision"]["id"]
    # And the decision explains where it came from.
    assert "Portfel" in body["decision"]["insight"]

    listed = (await client.get("/api/v1/decisions/", headers=auth)).json()
    assert any(d["id"] == body["decision"]["id"] for d in listed)


async def test_promote_is_idempotent_across_a_session(client: AsyncClient, auth: dict):
    art = await _artifact_with_action(client, auth)
    first = await client.post(
        f"/api/v1/ba/{art['id']}/promote", json={"action_index": 0}, headers=auth
    )
    # Re-fetch the artifact rather than reusing the response: a nested in-place
    # mutation of the JSON column would not have been persisted, and only a fresh
    # read exposes that.
    reread = (await client.get(f"/api/v1/ba/{art['id']}", headers=auth)).json()
    assert reread["content"]["actions"][0]["decision_id"] == first.json()["decision"]["id"]

    second = await client.post(
        f"/api/v1/ba/{art['id']}/promote", json={"action_index": 0}, headers=auth
    )
    assert second.status_code == 201
    assert second.json()["decision"]["id"] == first.json()["decision"]["id"]
    listed = (await client.get("/api/v1/decisions/", headers=auth)).json()
    assert len(listed) == 1, "a double promote must not fork the decision loop"


async def test_promote_after_the_decision_was_deleted_recreates_it(
    client: AsyncClient, auth: dict
):
    art = await _artifact_with_action(client, auth)
    first = (await client.post(
        f"/api/v1/ba/{art['id']}/promote", json={"action_index": 0}, headers=auth
    )).json()
    assert (await client.delete(
        f"/api/v1/decisions/{first['decision']['id']}", headers=auth
    )).status_code in (200, 204)

    again = await client.post(
        f"/api/v1/ba/{art['id']}/promote", json={"action_index": 0}, headers=auth
    )
    assert again.status_code == 201, again.text
    assert again.json()["decision"]["id"] != first["decision"]["id"]


async def test_promote_rejects_an_out_of_range_action(client: AsyncClient, auth: dict):
    art = await _artifact_with_action(client, auth)
    # Beyond the schema's ceiling → 422 at the boundary.
    assert (await client.post(
        f"/api/v1/ba/{art['id']}/promote", json={"action_index": 99}, headers=auth
    )).status_code == 422
    # Inside the ceiling but past this artifact's list → 404.
    resp = await client.post(
        f"/api/v1/ba/{art['id']}/promote",
        json={"action_index": len(art["content"]["actions"])},
        headers=auth,
    )
    assert resp.status_code == 404, resp.text


async def test_promote_is_owner_scoped(client: AsyncClient, auth: dict):
    art = await _artifact_with_action(client, auth)
    reg = await client.post(
        "/api/v1/auth/register",
        json={"email": "ba-promote-mate@nexusbi.io", "password": "parol1234", "full_name": "M"},
    )
    auth2 = {"Authorization": f"Bearer {reg.json()['access_token']}"}
    resp = await client.post(
        f"/api/v1/ba/{art['id']}/promote", json={"action_index": 0}, headers=auth2
    )
    assert resp.status_code == 404
