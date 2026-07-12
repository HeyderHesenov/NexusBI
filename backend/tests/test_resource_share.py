"""Sharing dashboards + datasources to a workspace (render-as-owner + RLS safety)."""
from __future__ import annotations

from httpx import AsyncClient

from app.ai.types import ChartConfig, Text2SQLResult
from app.services import query_service


async def _register(client: AsyncClient, email: str) -> str:
    resp = await client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": "pw1234", "full_name": email.split("@")[0]},
    )
    return resp.json()["access_token"]


def _mock_chart_insight(monkeypatch) -> None:
    async def fake_chart(columns, data, nl):
        return ChartConfig(chart_type="table")

    async def fake_insight(data, nl, chart_type=""):
        return ""

    monkeypatch.setattr(query_service, "select_chart_type", fake_chart)
    monkeypatch.setattr(query_service, "generate_insight", fake_insight)


def _set_sql(monkeypatch, sql: str) -> None:
    async def gen(self, nl, schema, dtype="sqlite", extra_context=""):
        return Text2SQLResult(sql=sql, explanation="d", confidence=0.9)

    monkeypatch.setattr(query_service.Text2SQLEngine, "generate_sql", gen)


async def _materialize(client: AsyncClient, auth: dict, monkeypatch, name: str) -> str:
    """Build a real SQLite datasource (product_name, total) from the demo sales table."""
    sql = "SELECT product_name, SUM(revenue) AS total FROM sales GROUP BY product_name"
    _set_sql(monkeypatch, sql)
    mat = await client.post(
        "/api/v1/dataprep/materialize",
        json={"datasource_id": None, "sql": sql, "name": name},
        headers=auth,
    )
    assert mat.status_code in (200, 201), mat.text
    return mat.json()["id"]


async def _ask(client: AsyncClient, auth: dict, monkeypatch, ds_id: str, table: str) -> dict:
    _set_sql(monkeypatch, f"SELECT product_name, total FROM {table}")
    resp = await client.post(
        "/api/v1/query/ask", json={"nl_query": "hamısı", "datasource_id": ds_id}, headers=auth
    )
    return resp.json()


async def _make_workspace_with_member(
    client: AsyncClient, auth: dict, member_email: str
) -> tuple[str, dict]:
    ws = (await client.post("/api/v1/workspaces", json={"name": "Paylaşım"}, headers=auth)).json()
    t2 = await _register(client, member_email)
    auth2 = {"Authorization": f"Bearer {t2}"}
    await client.post(
        f"/api/v1/workspaces/{ws['id']}/members",
        json={"email": member_email, "role": "viewer"},
        headers=auth,
    )
    return ws["id"], auth2


async def test_shared_dashboard_is_read_only_for_members(
    client: AsyncClient, auth: dict, monkeypatch
):
    _mock_chart_insight(monkeypatch)
    _set_sql(monkeypatch, "SELECT region, SUM(revenue) AS total FROM sales GROUP BY region")
    qid = (
        await client.post(
            "/api/v1/query/ask", json={"nl_query": "region", "datasource_id": None}, headers=auth
        )
    ).json()["query_log_id"]
    dash_id = (
        await client.post("/api/v1/dashboard/", json={"name": "Paylaşılan"}, headers=auth)
    ).json()["id"]
    await client.post(
        f"/api/v1/dashboard/{dash_id}/widget",
        json={"query_log_id": qid, "title": "Region"},
        headers=auth,
    )

    ws_id, auth2 = await _make_workspace_with_member(client, auth, "shmate@nexusbi.io")
    # A third user who is NOT in the workspace.
    t3 = await _register(client, "outsider@nexusbi.io")
    auth3 = {"Authorization": f"Bearer {t3}"}

    # Before sharing, the member can't see the owner's dashboard.
    assert (await client.get(f"/api/v1/dashboard/{dash_id}", headers=auth2)).status_code == 404

    share = await client.post(
        f"/api/v1/workspaces/{ws_id}/resources",
        json={"resource_type": "dashboard", "resource_id": dash_id},
        headers=auth,
    )
    assert share.status_code == 201, share.text

    # Member now sees it — read-only (owned=False), widgets rendered.
    got = await client.get(f"/api/v1/dashboard/{dash_id}", headers=auth2)
    assert got.status_code == 200, got.text
    body = got.json()
    assert body["owned"] is False
    assert body["widgets"] and body["widgets"][0]["chart"]["data"]

    # The owner still sees it as owned.
    assert (await client.get(f"/api/v1/dashboard/{dash_id}", headers=auth)).json()["owned"] is True

    # Members cannot mutate a shared dashboard (fail-closed 404 on the owner-only path).
    assert (
        await client.put(f"/api/v1/dashboard/{dash_id}", json={"name": "x"}, headers=auth2)
    ).status_code == 404
    assert (await client.delete(f"/api/v1/dashboard/{dash_id}", headers=auth2)).status_code == 404

    # A non-member never sees it, shared or not.
    assert (await client.get(f"/api/v1/dashboard/{dash_id}", headers=auth3)).status_code == 404

    # Unshare → the member loses access again.
    un = await client.delete(
        f"/api/v1/workspaces/{ws_id}/resources/dashboard/{dash_id}", headers=auth
    )
    assert un.status_code == 204, un.text
    assert (await client.get(f"/api/v1/dashboard/{dash_id}", headers=auth2)).status_code == 404


async def test_shared_dashboard_never_leaks_owner_rows_past_member_rls(
    client: AsyncClient, auth: dict, monkeypatch
):
    """The RLS-leak invariant: a member with an RLS rule sees only their own scope
    of a shared dashboard's data — never the owner's unfiltered snapshot."""
    _mock_chart_insight(monkeypatch)
    ds_id = await _materialize(client, auth, monkeypatch, "leak_src")
    full = await _ask(client, auth, monkeypatch, ds_id, "leak_src")
    assert full["data"], full
    owner_row_count = len(full["data"])
    assert owner_row_count > 1  # several products, so a filter is observable
    allowed = full["data"][0]["product_name"]
    qid = full["query_log_id"]

    dash_id = (
        await client.post("/api/v1/dashboard/", json={"name": "Gizli"}, headers=auth)
    ).json()["id"]
    await client.post(
        f"/api/v1/dashboard/{dash_id}/widget",
        json={"query_log_id": qid, "title": "Məhsullar"},
        headers=auth,
    )

    ws_id, auth2 = await _make_workspace_with_member(client, auth, "rlsmate@nexusbi.io")

    # Owner restricts the member to a single product on the underlying datasource.
    rule = await client.post(
        f"/api/v1/datasource/{ds_id}/rls",
        json={"member_email": "rlsmate@nexusbi.io", "column": "product_name", "allowed_value": str(allowed)},
        headers=auth,
    )
    assert rule.status_code == 201, rule.text

    await client.post(
        f"/api/v1/workspaces/{ws_id}/resources",
        json={"resource_type": "dashboard", "resource_id": dash_id},
        headers=auth,
    )

    got = await client.get(f"/api/v1/dashboard/{dash_id}", headers=auth2)
    assert got.status_code == 200, got.text
    rows = got.json()["widgets"][0]["chart"]["data"]
    assert rows, "member should still see their own scope, not an empty board"
    # Only the allowed product, and strictly fewer rows than the owner's snapshot.
    assert all(r["product_name"] == allowed for r in rows)
    assert len(rows) < owner_row_count

    # The owner still sees everything.
    owner_view = await client.get(f"/api/v1/dashboard/{dash_id}", headers=auth)
    assert len(owner_view.json()["widgets"][0]["chart"]["data"]) == owner_row_count


async def test_shared_datasource_is_query_only_for_members(
    client: AsyncClient, auth: dict, monkeypatch
):
    _mock_chart_insight(monkeypatch)
    ds_id = await _materialize(client, auth, monkeypatch, "dsshare_src")
    full = await _ask(client, auth, monkeypatch, ds_id, "dsshare_src")
    allowed = full["data"][0]["product_name"]

    ws_id, auth2 = await _make_workspace_with_member(client, auth, "dsmate@nexusbi.io")

    # Before sharing, the member cannot query the owner's datasource.
    before = await _ask(client, auth2, monkeypatch, ds_id, "dsshare_src")
    assert "data" not in before or not before.get("data")

    # Owner restricts the member and shares the datasource.
    await client.post(
        f"/api/v1/datasource/{ds_id}/rls",
        json={"member_email": "dsmate@nexusbi.io", "column": "product_name", "allowed_value": str(allowed)},
        headers=auth,
    )
    share = await client.post(
        f"/api/v1/workspaces/{ws_id}/resources",
        json={"resource_type": "datasource", "resource_id": ds_id},
        headers=auth,
    )
    assert share.status_code == 201, share.text

    # The member can now query it — but only their RLS scope.
    after = await _ask(client, auth2, monkeypatch, ds_id, "dsshare_src")
    assert after["data"]
    assert all(r["product_name"] == allowed for r in after["data"])

    # The member can read the schema (to author queries) …
    assert (await client.get(f"/api/v1/datasource/{ds_id}/schema", headers=auth2)).status_code == 200
    # … but cannot manage RLS on someone else's datasource (owner-only).
    assert (await client.get(f"/api/v1/datasource/{ds_id}/rls", headers=auth2)).status_code == 404
    mrule = await client.post(
        f"/api/v1/datasource/{ds_id}/rls",
        json={"member_email": "dsmate@nexusbi.io", "column": "product_name", "allowed_value": "anything"},
        headers=auth2,
    )
    assert mrule.status_code == 404


async def test_only_owner_or_editor_can_share(client: AsyncClient, auth: dict, monkeypatch):
    _mock_chart_insight(monkeypatch)
    dash_id = (
        await client.post("/api/v1/dashboard/", json={"name": "D"}, headers=auth)
    ).json()["id"]
    ws_id, auth2 = await _make_workspace_with_member(client, auth, "viewer@nexusbi.io")

    # A viewer cannot share.
    forbidden = await client.post(
        f"/api/v1/workspaces/{ws_id}/resources",
        json={"resource_type": "dashboard", "resource_id": dash_id},
        headers=auth2,
    )
    assert forbidden.status_code == 403, forbidden.text

    # You can't share what you don't own (even as owner of the workspace).
    not_owned = await client.post(
        f"/api/v1/workspaces/{ws_id}/resources",
        json={"resource_type": "dashboard", "resource_id": "00000000-0000-0000-0000-000000000000"},
        headers=auth,
    )
    assert not_owned.status_code == 404, not_owned.text
