"""Metric-tree provenance: measured vs manual vs unknown, and unknown never becoming 0.

The bug class these guard is a number that LOOKS measured. A leaf used to be a
hand-typed float that the copilot reported as a KPI, and an empty leaf used to
be 0.0 — harmless-looking under `add`, and silently zeroing the whole product
under `mul`.
"""
from __future__ import annotations

import pytest
from httpx import AsyncClient

from app.ai.types import ChartConfig, Text2SQLResult
from app.services import metric_tree_service as svc
from app.services import query_service


@pytest.fixture(autouse=True)
def _mock_ai(monkeypatch):
    """Same offline stubs test_saved_query uses, so /saved/{id}/run is deterministic."""

    async def fake_sql(self, nl, schema, dtype="sqlite", extra_context=""):
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


async def _node(client: AsyncClient, auth: dict, **kw) -> dict:
    r = await client.post("/api/v1/metric-tree/", json=kw, headers=auth)
    assert r.status_code == 201, r.text
    return r.json()


async def _forest(client: AsyncClient, auth: dict) -> list[dict]:
    r = await client.get("/api/v1/metric-tree/evaluate", headers=auth)
    assert r.status_code == 200, r.text
    return r.json()


async def _ran_saved_query(client: AsyncClient, auth: dict) -> tuple[str, list[dict]]:
    """A saved query with a stored result — the only thing a measured leaf reads."""
    created = await client.post(
        "/api/v1/saved/", json={"name": "Top məhsullar", "nl_query": "ən çox satan"}, headers=auth
    )
    assert created.status_code == 201, created.text
    sq_id = created.json()["id"]
    run = await client.post(f"/api/v1/saved/{sq_id}/run", headers=auth)
    assert run.status_code == 200, run.text
    return sq_id, run.json()["data"]


# ─── The arithmetic ───

def test_combine_propagates_unknown():
    # Unknown in, unknown out — under EVERY operator. `mul` is the one that
    # mattered: treating None as 0 there returns 0.0, a number the UI and the
    # copilot would both have presented as the KPI.
    assert svc._combine("mul", [2, None]) is None
    assert svc._combine("add", [1, None, 3]) is None
    assert svc._combine("sub", [10, None]) is None
    assert svc._combine("div", [None, 2]) is None
    # Known inputs are untouched, including the documented edge cases.
    assert svc._combine("mul", [2, 3, 4]) == 24
    assert svc._combine("div", [10, 0]) == 0
    assert svc._combine("add", []) == 0


def test_aggregate_reductions_and_refusals():
    rows = [{"c": 4}, {"c": 1}, {"c": 5}]
    assert svc._aggregate(rows, "c", "sum") == (10.0, None)
    assert svc._aggregate(rows, "c", "avg") == (pytest.approx(10 / 3), None)
    assert svc._aggregate(rows, "c", "min") == (1.0, None)
    assert svc._aggregate(rows, "c", "max") == (5.0, None)
    assert svc._aggregate(rows, "c", "last") == (5.0, None)
    assert svc._aggregate(rows, "c", "count") == (3.0, None)

    # Refusals carry a reason instead of a number.
    assert svc._aggregate([], "c", "sum") == (None, svc.REASON_NO_ROWS)
    assert svc._aggregate(rows, "nope", "sum") == (None, svc.REASON_COLUMN_MISSING)
    assert svc._aggregate([{"c": "abc"}], "c", "sum") == (None, svc.REASON_NOT_NUMERIC)
    assert svc._aggregate(rows, "c", "median") == (None, svc.REASON_BAD_BINDING)

    # A column that is NULL everywhere EXISTS — saying "column_missing" would
    # send the user hunting for a typo that is not there.
    assert svc._aggregate([{"c": None}], "c", "sum") == (None, svc.REASON_NOT_NUMERIC)
    # bool is an int in Python; summing flags would manufacture a measurement.
    assert svc._aggregate([{"c": True}, {"c": False}], "c", "sum") == (None, svc.REASON_NOT_NUMERIC)
    # ...but counting them is legitimate: count is about rows, not magnitudes.
    assert svc._aggregate([{"c": True}, {"c": None}], "c", "count") == (1.0, None)


# ─── Unknown leaves ───

async def test_empty_leaf_does_not_zero_the_product(client: AsyncClient, auth: dict):
    root = await _node(client, auth, name="Gəlir", operator="mul")
    await _node(client, auth, name="Qiymət", parent_id=root["id"], manual_value=20)
    await _node(client, auth, name="Həcm", parent_id=root["id"])  # nothing entered

    tree = (await _forest(client, auth))[0]
    # The old behaviour was 20 × 0 = 0.0 reported as the KPI. There is no honest
    # number here, so there is no number.
    assert tree["value"] is None
    assert tree["incomplete"] is True
    empty = next(c for c in tree["children"] if c["name"] == "Həcm")
    assert empty["provenance"] == "unknown"
    assert empty["unknown_reason"] == "empty"
    priced = next(c for c in tree["children"] if c["name"] == "Qiymət")
    assert priced["provenance"] == "manual" and priced["value"] == 20.0


async def test_clearing_manual_value_returns_a_leaf_to_unknown(client: AsyncClient, auth: dict):
    root = await _node(client, auth, name="Cəm", operator="add")
    leaf = await _node(client, auth, name="A", parent_id=root["id"], manual_value=75)
    assert (await _forest(client, auth))[0]["value"] == 75.0

    # An explicit null must clear it. If PATCH read null as "field omitted" there
    # would be no way to express "I do not know this yet" once a value was typed.
    patched = await client.patch(
        f"/api/v1/metric-tree/{leaf['id']}", json={"manual_value": None}, headers=auth
    )
    assert patched.status_code == 200, patched.text
    tree = (await _forest(client, auth))[0]
    assert tree["value"] is None and tree["incomplete"] is True


# ─── Measured leaves ───

async def test_query_bound_leaf_is_measured(client: AsyncClient, auth: dict):
    sq_id, rows = await _ran_saved_query(client, auth)
    expected = sum(float(r["total"]) for r in rows)

    root = await _node(client, auth, name="Gəlir", operator="add")
    await _node(
        client, auth, name="Satış", parent_id=root["id"],
        source_kind="query", saved_query_id=sq_id, value_column="total", agg="sum",
    )

    tree = (await _forest(client, auth))[0]
    leaf = tree["children"][0]
    assert leaf["provenance"] == "measured"
    assert leaf["value"] == pytest.approx(expected)
    assert tree["value"] == pytest.approx(expected)
    assert tree["incomplete"] is False
    # The origin travels with the number, and so does its age.
    assert leaf["source"] == "Top məhsullar / total (sum)"
    assert leaf["measured_at"] is not None
    # manual_value stays null — nothing was ever typed for this leaf.
    assert leaf["manual_value"] is None


async def test_deleting_the_saved_query_makes_the_leaf_unknown(client: AsyncClient, auth: dict):
    sq_id, _ = await _ran_saved_query(client, auth)
    root = await _node(client, auth, name="Gəlir", operator="add")
    await _node(
        client, auth, name="Satış", parent_id=root["id"],
        source_kind="query", saved_query_id=sq_id, value_column="total", agg="sum",
    )
    assert (await _forest(client, auth))[0]["value"] is not None

    assert (await client.delete(f"/api/v1/saved/{sq_id}", headers=auth)).status_code == 204

    tree = (await _forest(client, auth))[0]
    leaf = tree["children"][0]
    # The KPI node survives — the decomposition is still meaningful, its number
    # merely is not measurable. What it must not do is fall back to 0 or to a
    # stale manual value.
    assert leaf["provenance"] == "unknown"
    assert leaf["unknown_reason"] == "query_missing"
    assert tree["value"] is None


async def test_never_run_query_is_unknown_not_zero(client: AsyncClient, auth: dict):
    created = await client.post(
        "/api/v1/saved/", json={"name": "Heç qaçmayıb", "nl_query": "x"}, headers=auth
    )
    sq_id = created.json()["id"]
    root = await _node(client, auth, name="Gəlir", operator="add")
    await _node(
        client, auth, name="Satış", parent_id=root["id"],
        source_kind="query", saved_query_id=sq_id, value_column="total", agg="sum",
    )
    leaf = (await _forest(client, auth))[0]["children"][0]
    assert leaf["provenance"] == "unknown" and leaf["unknown_reason"] == "never_run"
    assert leaf["value"] is None


async def test_missing_column_is_named_as_such(client: AsyncClient, auth: dict):
    sq_id, _ = await _ran_saved_query(client, auth)
    root = await _node(client, auth, name="Gəlir", operator="add")
    await _node(
        client, auth, name="Satış", parent_id=root["id"],
        source_kind="query", saved_query_id=sq_id, value_column="yoxdur", agg="sum",
    )
    leaf = (await _forest(client, auth))[0]["children"][0]
    assert leaf["unknown_reason"] == "column_missing"
    # A wrong column must NOT quietly measure a different one — the reason a
    # decision_service.extract_scalar-style "first numeric column" fallback is
    # not reused here.
    assert leaf["value"] is None


async def test_bindable_lists_only_queries_with_a_stored_run(client: AsyncClient, auth: dict):
    await client.post("/api/v1/saved/", json={"name": "Heç qaçmayıb", "nl_query": "x"}, headers=auth)
    sq_id, _ = await _ran_saved_query(client, auth)

    resp = await client.get("/api/v1/metric-tree/bindable", headers=auth)
    assert resp.status_code == 200, resp.text
    sources = resp.json()
    # A query with no stored run would bind to a leaf that reads `never_run`,
    # which looks like a bug from the form's side. It is not offered.
    assert [s["saved_query_id"] for s in sources] == [sq_id]
    assert set(sources[0]["columns"]) == {"product_name", "total"}
    assert sources[0]["last_run_at"] is not None


async def test_bindable_is_owner_scoped(client: AsyncClient, auth: dict):
    await _ran_saved_query(client, auth)
    other = await client.post(
        "/api/v1/auth/register",
        json={"email": "nosy@nexusbi.io", "password": "pw1234", "full_name": "N"},
    )
    other_auth = {"Authorization": f"Bearer {other.json()['access_token']}"}
    resp = await client.get("/api/v1/metric-tree/bindable", headers=other_auth)
    assert resp.json() == []


# ─── The binding is owner-scoped and validated ───

async def test_cannot_bind_to_another_users_saved_query(client: AsyncClient, auth: dict):
    sq_id, _ = await _ran_saved_query(client, auth)
    other = await client.post(
        "/api/v1/auth/register",
        json={"email": "intruder@nexusbi.io", "password": "pw1234", "full_name": "Mal"},
    )
    other_auth = {"Authorization": f"Bearer {other.json()['access_token']}"}

    resp = await client.post(
        "/api/v1/metric-tree/",
        json={"name": "Oğurluq", "source_kind": "query", "saved_query_id": sq_id,
              "value_column": "total", "agg": "sum"},
        headers=other_auth,
    )
    # 404, not 403: "not yours" and "does not exist" must look identical.
    assert resp.status_code == 404, resp.text


async def test_half_filled_binding_is_rejected(client: AsyncClient, auth: dict):
    sq_id, _ = await _ran_saved_query(client, auth)
    resp = await client.post(
        "/api/v1/metric-tree/",
        json={"name": "Yarımçıq", "source_kind": "query", "saved_query_id": sq_id},
        headers=auth,
    )
    assert resp.status_code == 422, resp.text


async def test_binding_fields_without_source_kind_are_rejected(client: AsyncClient, auth: dict):
    sq_id, _ = await _ran_saved_query(client, auth)
    leaf = await _node(client, auth, name="A", manual_value=1)
    resp = await client.patch(
        f"/api/v1/metric-tree/{leaf['id']}", json={"saved_query_id": sq_id}, headers=auth
    )
    # Accepting this would return 200 having changed nothing: the service applies
    # the binding as a unit keyed on source_kind.
    assert resp.status_code == 422, resp.text


async def test_switching_back_to_manual_clears_the_binding(client: AsyncClient, auth: dict):
    sq_id, _ = await _ran_saved_query(client, auth)
    leaf = await _node(
        client, auth, name="Satış", manual_value=7,
        source_kind="query", saved_query_id=sq_id, value_column="total", agg="sum",
    )
    assert (await _forest(client, auth))[0]["provenance"] == "measured"

    patched = await client.patch(
        f"/api/v1/metric-tree/{leaf['id']}", json={"source_kind": "manual"}, headers=auth
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["saved_query_id"] is None
    tree = (await _forest(client, auth))[0]
    # The hand-typed value it had before comes back — kept precisely so this
    # round trip does not destroy the user's number.
    assert tree["provenance"] == "manual" and tree["value"] == 7.0


# ─── The AI boundary ───

async def test_copilot_tool_labels_every_leaf(client: AsyncClient, auth: dict):
    sq_id, rows = await _ran_saved_query(client, auth)
    root = await _node(client, auth, name="Gəlir", operator="add")
    await _node(
        client, auth, name="Satış", parent_id=root["id"],
        source_kind="query", saved_query_id=sq_id, value_column="total", agg="sum",
    )
    await _node(client, auth, name="Təxmin", parent_id=root["id"], manual_value=5)
    await _node(client, auth, name="Bilinmir", parent_id=root["id"])

    from app.ai import copilot
    from tests.conftest import _Session

    me = (await client.get("/api/v1/auth/me", headers=auth)).json()
    async with _Session() as session:
        ctx = copilot._ToolContext(session, None, me["id"])  # type: ignore[arg-type]
        out = await ctx.dispatch("evaluate_metric_tree", {})

    assert out["measured_leaves"] == ["Satış"]
    assert out["manual_leaves"] == ["Təxmin"]
    assert out["unknown_leaves"] == ["Bilinmir"]
    assert out["fully_measured"] is False and out["has_unknown"] is True
    # The constraint travels WITH the data, not only in the system prompt.
    assert "rəqəm söyləmə" in out["reporting_rule"].lower()

    leaves = {leaf["name"]: leaf for leaf in out["roots"][0]["leaves"]}
    assert leaves["Satış"]["source"] == "measured"
    assert leaves["Satış"]["measured_from"] == "Top məhsullar / total (sum)"
    assert leaves["Təxmin"]["source"] == "manual"
    assert leaves["Bilinmir"]["source"] == "unknown"
    assert leaves["Bilinmir"]["unknown_reason"] == "empty"
    # One unknown leaf under an additive root leaves the root with no value.
    assert out["roots"][0]["value"] is None and out["roots"][0]["incomplete"] is True


async def test_fully_measured_tree_carries_no_warning(client: AsyncClient, auth: dict):
    sq_id, rows = await _ran_saved_query(client, auth)
    root = await _node(client, auth, name="Gəlir", operator="add")
    await _node(
        client, auth, name="Satış", parent_id=root["id"],
        source_kind="query", saved_query_id=sq_id, value_column="total", agg="sum",
    )

    from app.ai import copilot
    from tests.conftest import _Session

    me = (await client.get("/api/v1/auth/me", headers=auth)).json()
    async with _Session() as session:
        ctx = copilot._ToolContext(session, None, me["id"])  # type: ignore[arg-type]
        out = await ctx.dispatch("evaluate_metric_tree", {})

    assert out["fully_measured"] is True
    # No warning when there is nothing to warn about — a rule attached to every
    # result would be tuned out on the one that matters.
    assert "reporting_rule" not in out


# ─── Simulation ───

async def test_simulation_scales_the_measured_value(client: AsyncClient, auth: dict):
    sq_id, rows = await _ran_saved_query(client, auth)
    expected = sum(float(r["total"]) for r in rows)
    root = await _node(client, auth, name="Gəlir", operator="add")
    await _node(
        client, auth, name="Satış", parent_id=root["id"],
        source_kind="query", saved_query_id=sq_id, value_column="total", agg="sum",
    )

    from app.ai import copilot
    from tests.conftest import _Session

    me = (await client.get("/api/v1/auth/me", headers=auth)).json()
    async with _Session() as session:
        ctx = copilot._ToolContext(session, None, me["id"])  # type: ignore[arg-type]
        out = await ctx.dispatch(
            "simulate_metric_tree", {"changes": [{"leaf_name": "Satış", "pct": 10}]}
        )

    res = out["results"][0]
    # The lever must scale the MEASURED number. Reading manual_value here (null
    # for a measured leaf) would scale from 0 and report the scenario as if the
    # lever did nothing.
    assert res["baseline"] == pytest.approx(round(expected, 2))
    assert res["simulated"] == pytest.approx(round(expected * 1.1, 2))


async def test_simulation_refuses_a_root_with_an_unknown_leaf(client: AsyncClient, auth: dict):
    root = await _node(client, auth, name="Gəlir", operator="mul")
    await _node(client, auth, name="Qiymət", parent_id=root["id"], manual_value=20)
    await _node(client, auth, name="Həcm", parent_id=root["id"])

    from app.ai import copilot
    from tests.conftest import _Session

    me = (await client.get("/api/v1/auth/me", headers=auth)).json()
    async with _Session() as session:
        ctx = copilot._ToolContext(session, None, me["id"])  # type: ignore[arg-type]
        out = await ctx.dispatch(
            "simulate_metric_tree", {"changes": [{"leaf_name": "Qiymət", "pct": 10}]}
        )

    res = out["results"][0]
    assert res["baseline"] is None and res["simulated"] is None
    assert res["incomplete"] is True
    assert out["has_unknown"] is True
