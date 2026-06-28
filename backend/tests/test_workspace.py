"""Workspaces (RBAC), RLS rules + enforcement, and audit log."""
from __future__ import annotations

import pytest
from httpx import AsyncClient

from app.ai.types import ChartConfig, Text2SQLResult
from app.models.workspace import RLSRule
from app.services import query_service, rls_service


# ── RLS row filtering (unit) ──
def test_rls_apply_filters_rows():
    rules = [
        RLSRule(datasource_id="d", owner_id="o", member_id="m", column="region", allowed_value="West"),
    ]
    rows = [{"region": "West", "v": 1}, {"region": "East", "v": 2}, {"region": "West", "v": 3}]
    out = rls_service.apply(rows, rules)
    assert {r["region"] for r in out} == {"West"}
    assert len(out) == 2


def test_rls_apply_no_rules_is_passthrough():
    rows = [{"a": 1}]
    assert rls_service.apply(rows, []) == rows


def test_rls_apply_fail_closed_on_missing_column():
    rules = [RLSRule(datasource_id="d", owner_id="o", member_id="m", column="region", allowed_value="West")]
    rows = [{"other": 1}]  # constrained column absent → fail-closed, row dropped
    assert rls_service.apply(rows, rules) == []


# ── Workspace RBAC (integration) ──
async def _register(client: AsyncClient, email: str) -> str:
    resp = await client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": "pw1234", "full_name": email.split("@")[0]},
    )
    return resp.json()["access_token"]


async def test_workspace_rbac_flow(client: AsyncClient, auth: dict):
    ws = (await client.post("/api/v1/workspaces", json={"name": "Komanda"}, headers=auth)).json()
    assert ws["role"] == "owner"

    # Second user, added as viewer.
    t2 = await _register(client, "mate@nexusbi.io")
    auth2 = {"Authorization": f"Bearer {t2}"}
    added = await client.post(
        f"/api/v1/workspaces/{ws['id']}/members",
        json={"email": "mate@nexusbi.io", "role": "viewer"},
        headers=auth,
    )
    assert added.status_code == 201, added.text

    # Viewer can see members but cannot add one (needs owner).
    forbidden = await client.post(
        f"/api/v1/workspaces/{ws['id']}/members",
        json={"email": "mate@nexusbi.io", "role": "editor"},
        headers=auth2,
    )
    assert forbidden.status_code == 403

    members = (await client.get(f"/api/v1/workspaces/{ws['id']}/members", headers=auth2)).json()
    assert {m["email"] for m in members} == {"test@nexusbi.io", "mate@nexusbi.io"}

    # The workspace shows up for the invited member too.
    mine2 = (await client.get("/api/v1/workspaces", headers=auth2)).json()
    assert any(w["id"] == ws["id"] for w in mine2)


async def test_audit_log_records_actions(client: AsyncClient, auth: dict):
    await client.post("/api/v1/workspaces", json={"name": "Audit WS"}, headers=auth)
    audit = (await client.get("/api/v1/audit", headers=auth)).json()
    assert any(a["action"] == "workspace.create" for a in audit)


# ── RLS enforcement through the query pipeline ──
async def test_rls_enforced_in_query(client: AsyncClient, auth: dict, monkeypatch):
    async def fake_chart(columns, data, nl):
        return ChartConfig(chart_type="table")

    async def fake_insight(data, nl, chart_type=""):
        return ""

    monkeypatch.setattr(query_service, "select_chart_type", fake_chart)
    monkeypatch.setattr(query_service, "generate_insight", fake_insight)

    # Build a real SQLite datasource from a demo transform.
    async def demo_sql(self, nl, schema, dtype="sqlite", extra_context=""):
        return Text2SQLResult(
            sql="SELECT product_name, SUM(revenue) AS total FROM sales GROUP BY product_name",
            explanation="d", confidence=0.9,
        )

    monkeypatch.setattr(query_service.Text2SQLEngine, "generate_sql", demo_sql)
    mat = await client.post(
        "/api/v1/dataprep/materialize",
        json={"datasource_id": None, "sql": "SELECT product_name, SUM(revenue) AS total FROM sales GROUP BY product_name", "name": "rls_src"},
        headers=auth,
    )
    ds_id = mat.json()["id"]

    # Query the derived source (no rule yet) to learn a real value.
    async def src_sql(self, nl, schema, dtype="sqlite", extra_context=""):
        return Text2SQLResult(sql="SELECT product_name, total FROM rls_src", explanation="d", confidence=0.9)

    monkeypatch.setattr(query_service.Text2SQLEngine, "generate_sql", src_sql)
    full = (
        await client.post(
            "/api/v1/query/ask", json={"nl_query": "hamısı", "datasource_id": ds_id}, headers=auth
        )
    ).json()
    assert full["data"], full
    allowed = full["data"][0]["product_name"]

    # Add an RLS rule restricting THIS user to that single product.
    rule = await client.post(
        f"/api/v1/datasource/{ds_id}/rls",
        json={"member_email": "test@nexusbi.io", "column": "product_name", "allowed_value": str(allowed)},
        headers=auth,
    )
    assert rule.status_code == 201, rule.text

    restricted = (
        await client.post(
            "/api/v1/query/ask", json={"nl_query": "yenə", "datasource_id": ds_id}, headers=auth
        )
    ).json()
    assert restricted["data"]
    assert all(r["product_name"] == allowed for r in restricted["data"])
