"""NL data-prep (preview/materialize) + profiling tests."""
from __future__ import annotations

import pytest

from app.ai import data_prep
from app.services import profiling_service

_SQL = "SELECT product_name, SUM(revenue) AS total FROM sales GROUP BY product_name"


@pytest.fixture(autouse=True)
def _mock_plan(monkeypatch):
    async def fake_chat_json(system, user, **kw):
        return {"sql": _SQL, "steps": ["sales qruplandı"], "warnings": []}

    monkeypatch.setattr(data_prep, "chat_json", fake_chat_json)


def test_profile_rows_stats():
    rows = [
        {"region": "West", "amount": 100},
        {"region": "East", "amount": None},
        {"region": "West", "amount": 50},
    ]
    out = profiling_service._profile_rows(["region", "amount"], rows)
    region = next(c for c in out if c["column"] == "region")
    amount = next(c for c in out if c["column"] == "amount")
    assert region["dtype"] == "text"
    assert region["distinct"] == 2
    assert amount["dtype"] == "number"
    assert amount["null_pct"] == pytest.approx(33.3, abs=0.2)
    assert amount["max"] == 100


def test_data_prep_rule_based_passthrough():
    schema = "- sales(product_name (TEXT), revenue (REAL))\n- customers(id (INT))"
    out = data_prep._rule_based(schema, "sales cədvəlini göstər")
    assert "sales" in out["sql"].lower()
    assert out["warnings"]


async def test_preview_demo(client, auth):
    resp = await client.post(
        "/api/v1/dataprep/preview",
        json={"datasource_id": None, "instruction": "məhsul üzrə gəlir"},
        headers=auth,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["sql"] == _SQL
    assert body["columns"]
    assert body["rows"]


async def test_materialize_then_profile(client, auth):
    # Materialize the demo transform into a new SQLite datasource.
    mat = await client.post(
        "/api/v1/dataprep/materialize",
        json={"datasource_id": None, "sql": _SQL, "name": "derived_demo"},
        headers=auth,
    )
    assert mat.status_code == 201, mat.text
    ds_id = mat.json()["id"]

    # It shows up as a normal datasource and can be profiled.
    profile = await client.get(
        f"/api/v1/datasource/{ds_id}/profile",
        params={"table": "derived_demo"},
        headers=auth,
    )
    assert profile.status_code == 200, profile.text
    body = profile.json()
    cols = {c["column"] for c in body["columns"]}
    assert "product_name" in cols
    assert any(c["dtype"] == "number" for c in body["columns"])


async def test_materialize_rejects_non_select(client, auth):
    resp = await client.post(
        "/api/v1/dataprep/materialize",
        json={"datasource_id": None, "sql": "DROP TABLE sales", "name": "x"},
        headers=auth,
    )
    assert resp.status_code >= 400


# ─── Guard chain: data-prep must not be a way around it ───
#
# SELECT-only validation was the only guard on this path. It does not check WHICH
# tables the statement touches and it does not apply row-level security, so an
# instruction that planned SQL over a table the caller cannot otherwise read used
# to run. These pin data-prep to the same chain every other read goes through.


async def test_preview_rejects_table_outside_demo_schema(client, auth, monkeypatch):
    """A planned SELECT over a table outside the demo model must be refused.

    The planner is an LLM, so its output is untrusted input: a prompt-injected or
    hallucinated table name reaches the executor exactly like an attacker-chosen
    one would.
    """
    async def foreign_table_plan(system, user, **kw):
        return {"sql": "SELECT * FROM injected_secrets", "steps": [], "warnings": []}

    monkeypatch.setattr(data_prep, "chat_json", foreign_table_plan)
    resp = await client.post(
        "/api/v1/dataprep/preview",
        json={"datasource_id": None, "instruction": "hər şeyi göstər"},
        headers=auth,
    )
    assert resp.status_code >= 400, resp.text


async def test_materialize_rejects_table_outside_source_schema(client, auth):
    """Client-supplied SQL is bounded by the chosen source's own schema."""
    mat = await client.post(
        "/api/v1/dataprep/materialize",
        json={"datasource_id": None, "sql": _SQL, "name": "guarded_src"},
        headers=auth,
    )
    assert mat.status_code == 201, mat.text
    ds_id = mat.json()["id"]

    # `sales` exists in the demo model but NOT in the derived source just created.
    resp = await client.post(
        "/api/v1/dataprep/materialize",
        json={"datasource_id": ds_id, "sql": "SELECT * FROM sales", "name": "escape"},
        headers=auth,
    )
    assert resp.status_code >= 400, resp.text


async def test_preview_applies_member_rls(client, auth, monkeypatch):
    """A member restricted by RLS sees only their scope through data-prep too.

    Row-level security constrains before aggregation in the normal query path; a
    second execution path that skipped it would make the guarantee worthless,
    since the same rows are one instruction away.
    """
    from tests.test_resource_share import _make_workspace_with_member

    mat = await client.post(
        "/api/v1/dataprep/materialize",
        json={"datasource_id": None, "sql": _SQL, "name": "rls_src"},
        headers=auth,
    )
    assert mat.status_code == 201, mat.text
    ds_id = mat.json()["id"]

    # Re-point the planner at the derived source's own table; the module-level
    # mock plans over `sales`, which the allowlist correctly refuses here.
    async def plan_derived(system, user, **kw):
        return {"sql": "SELECT product_name, total FROM rls_src", "steps": [], "warnings": []}

    monkeypatch.setattr(data_prep, "chat_json", plan_derived)

    owner_view = await client.post(
        "/api/v1/dataprep/preview",
        json={"datasource_id": ds_id, "instruction": "hamısı"},
        headers=auth,
    )
    assert owner_view.status_code == 200, owner_view.text

    ws_id, auth2 = await _make_workspace_with_member(client, auth, "prepmate@nexusbi.io")
    await client.post(
        f"/api/v1/workspaces/{ws_id}/resources",
        json={"resource_type": "datasource", "resource_id": ds_id},
        headers=auth,
    )
    allowed = owner_view.json()["rows"][0]["product_name"]
    rule = await client.post(
        f"/api/v1/datasource/{ds_id}/rls",
        json={
            "member_email": "prepmate@nexusbi.io",
            "column": "product_name",
            "allowed_value": str(allowed),
        },
        headers=auth,
    )
    assert rule.status_code == 201, rule.text

    member_view = await client.post(
        "/api/v1/dataprep/preview",
        json={"datasource_id": ds_id, "instruction": "hamısı"},
        headers=auth2,
    )
    assert member_view.status_code == 200, member_view.text
    products = {r["product_name"] for r in member_view.json()["rows"]}
    assert products == {allowed}, products
    assert len(owner_view.json()["rows"]) > len(member_view.json()["rows"])


async def test_profile_applies_member_rls_and_does_not_share_its_cache(client, auth):
    """Profiling is a read of the same rows, so it obeys the same rules.

    It used to call execute_select directly: a member restricted to one product
    got min/max/distinct across everyone's rows. The cache key was per-source too,
    so whoever profiled first decided what the other one saw.
    """
    from tests.test_resource_share import _make_workspace_with_member

    mat = await client.post(
        "/api/v1/dataprep/materialize",
        json={"datasource_id": None, "sql": _SQL, "name": "prof_src"},
        headers=auth,
    )
    assert mat.status_code == 201, mat.text
    ds_id = mat.json()["id"]

    def distinct_products(body: dict) -> int:
        return next(c["distinct"] for c in body["columns"] if c["column"] == "product_name")

    owner = await client.get(
        f"/api/v1/datasource/{ds_id}/profile", params={"table": "prof_src"}, headers=auth
    )
    assert owner.status_code == 200, owner.text
    assert distinct_products(owner.json()) > 1

    ws_id, auth2 = await _make_workspace_with_member(client, auth, "profmate@nexusbi.io")
    await client.post(
        f"/api/v1/workspaces/{ws_id}/resources",
        json={"resource_type": "datasource", "resource_id": ds_id},
        headers=auth,
    )
    rule = await client.post(
        f"/api/v1/datasource/{ds_id}/rls",
        json={
            "member_email": "profmate@nexusbi.io",
            "column": "product_name",
            "allowed_value": "Product A0",
        },
        headers=auth,
    )
    assert rule.status_code == 201, rule.text

    member = await client.get(
        f"/api/v1/datasource/{ds_id}/profile", params={"table": "prof_src"}, headers=auth2
    )
    assert member.status_code == 200, member.text
    assert distinct_products(member.json()) == 1
    assert member.json()["row_sample"] < owner.json()["row_sample"]


async def test_materialize_is_rate_limited(client, auth):
    """Each call runs client SQL and writes a new SQLite file — bound the rate."""
    last = None
    for i in range(12):
        last = await client.post(
            "/api/v1/dataprep/materialize",
            json={"datasource_id": None, "sql": _SQL, "name": f"flood_{i}"},
            headers=auth,
        )
    assert last.status_code == 429, last.text
