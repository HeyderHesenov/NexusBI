"""Deny-by-default row scope: rls_service.scope_for + the strict source end to end.

The unit matrix below is the whole point of the RLSScope sentinel: "no rule" means
UNRESTRICTED on an open source and DENIED on a strict one, and a bare rule list
cannot tell those apart.
"""
from __future__ import annotations

from types import SimpleNamespace

from httpx import AsyncClient

from app.models.datasource import RLS_OPEN, RLS_STRICT
from app.services import rls_service
from tests.test_resource_share import (
    _ask,
    _make_workspace_with_member,
    _materialize,
    _mock_chart_insight,
)

OWNER = "owner-id"
MEMBER = "member-id"


def _ds(mode: str) -> SimpleNamespace:
    return SimpleNamespace(id="ds-1", user_id=OWNER, rls_mode=mode)


def _rule() -> SimpleNamespace:
    return SimpleNamespace(column="region", allowed_value="EU")


# ─── the 2 × 2 × 2 matrix ───


def test_open_member_without_rule_is_unrestricted():
    scope = rls_service.scope_for(_ds(RLS_OPEN), MEMBER, [])
    assert not scope.deny_all and not scope.restricted


def test_strict_member_without_rule_is_denied():
    scope = rls_service.scope_for(_ds(RLS_STRICT), MEMBER, [])
    assert scope.deny_all and scope.restricted


def test_member_with_rule_is_filtered_not_denied():
    for mode in (RLS_OPEN, RLS_STRICT):
        scope = rls_service.scope_for(_ds(mode), MEMBER, [_rule()])
        assert scope.rules and not scope.deny_all
        assert scope.restricted


def test_owner_is_exempt_from_the_strict_deny():
    # Locking a source must never lock out the person who locked it.
    for mode in (RLS_OPEN, RLS_STRICT):
        scope = rls_service.scope_for(_ds(mode), OWNER, [])
        assert not scope.deny_all and not scope.restricted


def test_owner_is_still_bound_by_a_rule_they_wrote_about_themselves():
    # The exemption covers the IMPLICIT deny only — an explicit rule is an
    # explicit instruction and binds whoever it names.
    scope = rls_service.scope_for(_ds(RLS_STRICT), OWNER, [_rule()])
    assert scope.rules and not scope.deny_all


# ─── end to end: exit criterion (c) of Faza 1 ───


async def test_new_source_is_strict_and_denies_a_ruleless_member(
    client: AsyncClient, auth: dict, monkeypatch
):
    _mock_chart_insight(monkeypatch)
    ds_id = await _materialize(client, auth, monkeypatch, "strict_src")

    # A source created today is locked by default; existing ones are not (server_default).
    listed = (await client.get("/api/v1/datasource/", headers=auth)).json()
    assert next(d for d in listed if d["id"] == ds_id)["rls_mode"] == "strict"

    owner_view = await _ask(client, auth, monkeypatch, ds_id, "strict_src")
    assert owner_view["data"], "the owner is never constrained by the lock"
    allowed = owner_view["data"][0]["product_name"]

    ws_id, auth2 = await _make_workspace_with_member(client, auth, "strictmate@nexusbi.io")
    share = await client.post(
        f"/api/v1/workspaces/{ws_id}/resources",
        json={"resource_type": "datasource", "resource_id": ds_id},
        headers=auth,
    )
    assert share.status_code == 201, share.text

    # Shared, readable, no rule → zero rows, and the client is told WHY.
    denied = await _ask(client, auth2, monkeypatch, ds_id, "strict_src")
    assert denied["data"] == []
    assert denied["rls_denied"] is True

    # One rule turns the deny into a filter.
    rule = await client.post(
        f"/api/v1/datasource/{ds_id}/rls",
        json={
            "member_email": "strictmate@nexusbi.io",
            "column": "product_name",
            "allowed_value": str(allowed),
        },
        headers=auth,
    )
    assert rule.status_code == 201, rule.text
    granted = await _ask(client, auth2, monkeypatch, ds_id, "strict_src")
    assert granted["data"]
    assert all(r["product_name"] == allowed for r in granted["data"])
    assert granted["rls_denied"] is False


async def test_unlocking_a_source_restores_full_member_access(
    client: AsyncClient, auth: dict, monkeypatch
):
    _mock_chart_insight(monkeypatch)
    ds_id = await _materialize(client, auth, monkeypatch, "unlock_src")
    owner_rows = len((await _ask(client, auth, monkeypatch, ds_id, "unlock_src"))["data"])

    ws_id, auth2 = await _make_workspace_with_member(client, auth, "unlockmate@nexusbi.io")
    await client.post(
        f"/api/v1/workspaces/{ws_id}/resources",
        json={"resource_type": "datasource", "resource_id": ds_id},
        headers=auth,
    )
    assert (await _ask(client, auth2, monkeypatch, ds_id, "unlock_src"))["data"] == []

    unlocked = await client.patch(
        f"/api/v1/datasource/{ds_id}/rls-mode", json={"rls_mode": "open"}, headers=auth
    )
    assert unlocked.status_code == 200, unlocked.text
    assert unlocked.json()["rls_mode"] == "open"

    opened = await _ask(client, auth2, monkeypatch, ds_id, "unlock_src")
    assert len(opened["data"]) == owner_rows
    assert opened["rls_denied"] is False


async def test_rls_mode_is_owner_only(client: AsyncClient, auth: dict, monkeypatch):
    _mock_chart_insight(monkeypatch)
    ds_id = await _materialize(client, auth, monkeypatch, "modeguard_src")
    _, auth2 = await _make_workspace_with_member(client, auth, "modemate@nexusbi.io")

    forbidden = await client.patch(
        f"/api/v1/datasource/{ds_id}/rls-mode", json={"rls_mode": "open"}, headers=auth2
    )
    assert forbidden.status_code == 404, forbidden.text

    bad = await client.patch(
        f"/api/v1/datasource/{ds_id}/rls-mode", json={"rls_mode": "sometimes"}, headers=auth
    )
    assert bad.status_code == 422


async def test_strict_source_is_treated_as_restricted_for_broadcasts(
    client: AsyncClient, auth: dict, monkeypatch, db_session
):
    """A locked source must block the owner-scoped fan-out paths (live refresh,
    public/embed) even before anyone writes a single rule."""
    _mock_chart_insight(monkeypatch)
    ds_id = await _materialize(client, auth, monkeypatch, "broadcast_src")

    assert await rls_service.datasource_is_restricted(db_session, ds_id) is True

    await client.patch(
        f"/api/v1/datasource/{ds_id}/rls-mode", json={"rls_mode": "open"}, headers=auth
    )
    db_session.expire_all()
    assert await rls_service.datasource_is_restricted(db_session, ds_id) is False


async def test_shared_dashboard_denies_a_ruleless_member_on_a_strict_source(
    client: AsyncClient, auth: dict, monkeypatch
):
    """The leak this phase closes: before deny-by-default, "no rule" read as "no
    restriction", so a ruleless member was served the OWNER's stored snapshot."""
    _mock_chart_insight(monkeypatch)
    ds_id = await _materialize(client, auth, monkeypatch, "dashlock_src")
    full = await _ask(client, auth, monkeypatch, ds_id, "dashlock_src")
    assert full["data"], full
    owner_row_count = len(full["data"])
    qid = full["query_log_id"]

    dash_id = (
        await client.post("/api/v1/dashboard/", json={"name": "Kilidli"}, headers=auth)
    ).json()["id"]
    await client.post(
        f"/api/v1/dashboard/{dash_id}/widget",
        json={"query_log_id": qid, "title": "Məhsullar"},
        headers=auth,
    )

    ws_id, auth2 = await _make_workspace_with_member(client, auth, "dashlockmate@nexusbi.io")
    await client.post(
        f"/api/v1/workspaces/{ws_id}/resources",
        json={"resource_type": "dashboard", "resource_id": dash_id},
        headers=auth,
    )

    got = await client.get(f"/api/v1/dashboard/{dash_id}", headers=auth2)
    assert got.status_code == 200, got.text
    chart = got.json()["widgets"][0]["chart"]
    assert not (chart or {}).get("data"), "the owner's snapshot must not reach a denied member"

    # The owner's own view of the same dashboard is untouched.
    owner_view = await client.get(f"/api/v1/dashboard/{dash_id}", headers=auth)
    assert len(owner_view.json()["widgets"][0]["chart"]["data"]) == owner_row_count
