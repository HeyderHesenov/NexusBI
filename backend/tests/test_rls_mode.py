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
    """A locked source restricts somebody even before anyone writes a rule.

    ``viewer_ids=None`` is the anonymous branch: it answers "could any viewer be
    denied here?", which is the right question when the audience is a share token
    and nobody can be named. Callers that CAN name their audience pass one — see
    the live-refresh test above, where the same source broadcasts freely.
    """
    _mock_chart_insight(monkeypatch)
    ds_id = await _materialize(client, auth, monkeypatch, "broadcast_src")

    assert await rls_service.restricted_datasource_ids(db_session, {ds_id}, None) == {ds_id}

    await client.patch(
        f"/api/v1/datasource/{ds_id}/rls-mode", json={"rls_mode": "open"}, headers=auth
    )
    db_session.expire_all()
    assert await rls_service.restricted_datasource_ids(db_session, {ds_id}, None) == set()


async def _locked_source_dashboard(
    client: AsyncClient, auth: dict, monkeypatch, name: str
) -> tuple[str, str, int]:
    """A dashboard whose single widget is fed by a locked (strict) datasource.

    Returns (dashboard_id, datasource_id, owner_row_count) — the row count is the
    regression guard: whatever we blank for anonymous viewers must stay intact for
    the owner.
    """
    ds_id = await _materialize(client, auth, monkeypatch, name)
    full = await _ask(client, auth, monkeypatch, ds_id, name)
    assert full["data"], full
    dash_id = (
        await client.post("/api/v1/dashboard/", json={"name": name}, headers=auth)
    ).json()["id"]
    await client.post(
        f"/api/v1/dashboard/{dash_id}/widget",
        json={"query_log_id": full["query_log_id"], "title": name},
        headers=auth,
    )
    return dash_id, ds_id, len(full["data"])


async def test_public_and_embed_links_blank_a_locked_source(
    client: AsyncClient, auth: dict, monkeypatch
):
    """The guarantee the RLS dialog makes to the owner before they press Lock.

    ``rlsModal.modePublicWarning`` promises the widgets of a locked source stay
    blank on public and embed links; SECURITY.md and the datasource router say the
    same. An anonymous token holder can never hold a rule, so a strict source is
    denied by definition — serving the owner's stored snapshot would hand out
    exactly the rows the owner locked.
    """
    _mock_chart_insight(monkeypatch)
    dash_id, ds_id, owner_rows = await _locked_source_dashboard(
        client, auth, monkeypatch, "pub_lock"
    )

    token = (
        await client.post(f"/api/v1/dashboard/{dash_id}/share", headers=auth)
    ).json()["token"]
    shared = await client.get(f"/api/v1/public/dashboard/{token}")
    assert shared.status_code == 200, shared.text
    assert shared.json()["dashboard"]["widgets"][0]["chart"] is None

    embed_token = (
        await client.patch(
            f"/api/v1/dashboard/{dash_id}/embed", json={"enabled": True}, headers=auth
        )
    ).json()["token"]
    embedded = await client.get(f"/api/v1/public/embed/{embed_token}")
    assert embedded.status_code == 200, embedded.text
    assert embedded.json()["dashboard"]["widgets"][0]["chart"] is None

    # The owner's own view of the same dashboard is untouched.
    owner_view = await client.get(f"/api/v1/dashboard/{dash_id}", headers=auth)
    assert len(owner_view.json()["widgets"][0]["chart"]["data"]) == owner_rows

    # Unlocking restores the public view — the blanking tracks the mode, not the id.
    await client.patch(
        f"/api/v1/datasource/{ds_id}/rls-mode", json={"rls_mode": "open"}, headers=auth
    )
    reopened = await client.get(f"/api/v1/public/dashboard/{token}")
    assert len(reopened.json()["dashboard"]["widgets"][0]["chart"]["data"]) == owner_rows


async def test_clearing_the_public_filter_does_not_bypass_the_lock(
    client: AsyncClient, auth: dict, monkeypatch
):
    """The second door into the same snapshot.

    ``apply_global_filter`` returns the stored snapshots verbatim when the spec is
    empty, and that early return sits BEFORE the restricted-source check — so an
    anonymous POST with ``{}`` reads what the GET above refuses to serve.
    """
    from app.core import rate_limit as rl

    rl._HITS.pop("public_filter", None)
    _mock_chart_insight(monkeypatch)
    dash_id, _ds_id, _rows = await _locked_source_dashboard(
        client, auth, monkeypatch, "pub_clear"
    )
    token = (
        await client.post(f"/api/v1/dashboard/{dash_id}/share", headers=auth)
    ).json()["token"]

    cleared = await client.post(f"/api/v1/public/dashboard/{token}/filter", json={})
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["widgets"][0]["chart"] is None

    # And the lock covers the schema, not only the rows: a filter naming one of the
    # locked source's columns must be rejected like any unknown column, or the
    # accept/reject split answers "does it have a column called X?" one call at a time.
    probe = await client.post(
        f"/api/v1/public/dashboard/{token}/filter",
        json={"dimensions": [{"column": "product_name", "values": ["Product A0"]}]},
    )
    assert probe.status_code >= 400, probe.text


async def test_live_refresh_reads_the_room_instead_of_the_lock(
    client: AsyncClient, auth: dict, monkeypatch
):
    """A lock restricts people, and a room holding only the owner restricts nobody.

    The broadcast gate used to ask the audience-blind question ("does this source
    restrict ANYONE?"), which is `True` for every source created since deny-by-
    default landed — so a single-user dashboard on a real source showed a live
    indicator over frozen numbers. The guest half is the reason the gate exists at
    all and must keep holding.

    Note the coverage this closes: every other live test runs on `datasource_id:
    None` (demo mode), where the gate is never reached.
    """
    _mock_chart_insight(monkeypatch)
    dash_id, _ds_id, owner_rows = await _locked_source_dashboard(
        client, auth, monkeypatch, "live_lock"
    )
    owner_id = (await client.get("/api/v1/auth/me", headers=auth)).json()["id"]
    await client.patch(
        f"/api/v1/dashboard/{dash_id}/live",
        json={"enabled": True, "interval_seconds": 3},
        headers=auth,
    )

    from app.realtime import live_refresh

    sent: list[tuple[str, dict]] = []
    roster: list[dict] = [{"conn_id": "c1", "user_id": owner_id, "name": "", "color": ""}]

    async def fake_broadcast(room, message, exclude=None):
        sent.append((room, message))

    async def fake_presence(room):
        return roster

    monkeypatch.setattr(live_refresh.hub, "broadcast", fake_broadcast)
    monkeypatch.setattr(live_refresh.hub, "active_rooms", lambda: {dash_id})
    monkeypatch.setattr(live_refresh.hub, "presence", fake_presence)

    live_refresh._last_run.clear()
    await live_refresh._tick()
    assert len(sent) == 1, "the owner watching their own locked board gets updates"
    assert len(sent[0][1]["widgets"][0]["chart"]["data"]) == owner_rows

    # A share-link guest joins: user_id is None, so no rule can ever name them and
    # the owner-executed dataset must not reach the room.
    roster.append({"conn_id": "c2", "user_id": None, "name": "Qonaq 1", "color": ""})
    sent.clear()
    live_refresh._last_run.clear()
    await live_refresh._tick()
    assert sent == [], "an owner-scoped dataset must not fan out to a guest"


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


async def test_every_rls_mutation_evicts_the_caches_derived_from_the_old_scope(
    client: AsyncClient, auth: dict, monkeypatch
):
    """Query results AND profiles are per-viewer values computed under a row scope.
    A profile lives for ten minutes, so a tightening that only evicted `qcache:`
    would keep serving statistics over rows the viewer may no longer read.

    Recorded through a fake cache: the suite runs without Redis, where every cache
    call is a silent no-op and nothing is ever stored to observe.
    """
    from app.dependencies import get_cache

    purged: list[str] = []

    class RecordingCache:
        available = False

        async def get(self, key):
            return None

        async def set(self, key, value, ttl=3600):
            return None

        async def delete(self, key):
            return None

        async def delete_prefix(self, prefix):
            purged.append(prefix)

    _mock_chart_insight(monkeypatch)
    ds_id = await _materialize(client, auth, monkeypatch, "purge_src")
    _, auth2 = await _make_workspace_with_member(client, auth, "purgemate@nexusbi.io")

    client._transport.app.dependency_overrides[get_cache] = lambda: RecordingCache()
    try:
        for call in (
            client.patch(
                f"/api/v1/datasource/{ds_id}/rls-mode",
                json={"rls_mode": "open"},
                headers=auth,
            ),
            client.post(
                f"/api/v1/datasource/{ds_id}/rls",
                json={
                    "member_email": "purgemate@nexusbi.io",
                    "column": "product_name",
                    "allowed_value": "x",
                },
                headers=auth,
            ),
        ):
            purged.clear()
            resp = await call
            assert resp.status_code in (200, 201), resp.text
            assert f"qcache:{ds_id}:" in purged
            assert f"profile:{ds_id}:" in purged, purged

        rule_id = (
            await client.get(f"/api/v1/datasource/{ds_id}/rls", headers=auth)
        ).json()[0]["id"]
        purged.clear()
        gone = await client.delete(f"/api/v1/datasource/{ds_id}/rls/{rule_id}", headers=auth)
        assert gone.status_code == 204, gone.text
        assert f"qcache:{ds_id}:" in purged
        assert f"profile:{ds_id}:" in purged, purged
    finally:
        client._transport.app.dependency_overrides.pop(get_cache, None)
