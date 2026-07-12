"""Team chat: channels, room access, DM rules, tickets, unread, WS auth."""
from __future__ import annotations

from httpx import AsyncClient

from app.core.security import create_access_token, create_refresh_token, create_room_ticket
from app.services import chat_service


async def _register(client: AsyncClient, email: str, name: str | None = None) -> str:
    resp = await client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": "pw1234", "full_name": name or email.split("@")[0]},
    )
    return resp.json()["access_token"]


async def _members(client: AsyncClient, auth: dict, ws_id: str) -> dict[str, str]:
    m = (await client.get(f"/api/v1/workspaces/{ws_id}/members", headers=auth)).json()
    return {x["email"]: x["user_id"] for x in m}


async def _ws(client: AsyncClient, auth: dict, name: str = "Söhbət") -> str:
    return (await client.post("/api/v1/workspaces", json={"name": name}, headers=auth)).json()["id"]


async def _add(client: AsyncClient, auth: dict, ws_id: str, email: str, role: str) -> None:
    await client.post(
        f"/api/v1/workspaces/{ws_id}/members", json={"email": email, "role": role}, headers=auth
    )


async def test_channel_lifecycle_and_unread(client: AsyncClient, auth: dict, db_session):
    ws_id = await _ws(client, auth)
    t_ed = await _register(client, "ed@nexusbi.io")
    auth_ed = {"Authorization": f"Bearer {t_ed}"}
    t_vw = await _register(client, "vw@nexusbi.io")
    auth_vw = {"Authorization": f"Bearer {t_vw}"}
    await _add(client, auth, ws_id, "ed@nexusbi.io", "editor")
    await _add(client, auth, ws_id, "vw@nexusbi.io", "viewer")

    # A viewer can't create a channel; an editor can.
    assert (
        await client.post(f"/api/v1/workspaces/{ws_id}/channels", json={"name": "ümumi"}, headers=auth_vw)
    ).status_code == 403
    ch = await client.post(
        f"/api/v1/workspaces/{ws_id}/channels", json={"name": "ümumi"}, headers=auth_ed
    )
    assert ch.status_code == 201, ch.text
    ch_id = ch.json()["id"]
    room = chat_service.channel_room(ws_id, ch_id)

    # The owner sees the channel with 0 unread.
    chans = (await client.get(f"/api/v1/workspaces/{ws_id}/channels", headers=auth)).json()
    assert any(c["id"] == ch_id and c["unread"] == 0 for c in chans)

    # The editor posts (the WS path goes through the service) → owner has 1 unread.
    ed_id = (await _members(client, auth, ws_id))["ed@nexusbi.io"]
    await chat_service.post_message(db_session, room, ed_id, "Editor", "salam komanda")
    await db_session.commit()

    chans2 = (await client.get(f"/api/v1/workspaces/{ws_id}/channels", headers=auth)).json()
    assert next(c for c in chans2 if c["id"] == ch_id)["unread"] == 1

    hist = (await client.get(f"/api/v1/chat/history?room_key={room}", headers=auth)).json()
    assert len(hist) == 1 and hist[0]["content"] == "salam komanda"

    # Marking read clears the count.
    assert (
        await client.post("/api/v1/chat/read", json={"room_key": room}, headers=auth)
    ).status_code == 204
    chans3 = (await client.get(f"/api/v1/workspaces/{ws_id}/channels", headers=auth)).json()
    assert next(c for c in chans3 if c["id"] == ch_id)["unread"] == 0


async def test_room_access_and_dm_rules(client: AsyncClient, auth: dict, db_session):
    ws_id = await _ws(client, auth)
    for e in ("a@nexusbi.io", "b@nexusbi.io"):
        await _register(client, e)
        await _add(client, auth, ws_id, e, "viewer")
    t_out = await _register(client, "out@nexusbi.io")  # never joins the workspace
    ids = await _members(client, auth, ws_id)
    a_id, b_id = ids["a@nexusbi.io"], ids["b@nexusbi.io"]
    owner_id = ids["test@nexusbi.io"]
    out_id = (await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {t_out}"})).json()["id"]

    ch = await client.post(f"/api/v1/workspaces/{ws_id}/channels", json={"name": "genel"}, headers=auth)
    room = chat_service.channel_room(ws_id, ch.json()["id"])

    # Channel: members yes, outsider no.
    assert await chat_service.can_access_room(db_session, owner_id, room) is True
    assert await chat_service.can_access_room(db_session, a_id, room) is True
    assert await chat_service.can_access_room(db_session, out_id, room) is False

    # DM between two co-members: both can access; a non-participant can't.
    dm = chat_service.dm_room(a_id, b_id)
    assert await chat_service.can_access_room(db_session, a_id, dm) is True
    assert await chat_service.can_access_room(db_session, b_id, dm) is True
    assert await chat_service.can_access_room(db_session, out_id, dm) is False

    # DM with a non-co-member is refused even for a legit member (no cold DMs).
    dm_cold = chat_service.dm_room(a_id, out_id)
    assert await chat_service.can_access_room(db_session, a_id, dm_cold) is False


async def test_chat_ticket_requires_access(client: AsyncClient, auth: dict):
    ws_id = await _ws(client, auth)
    ch = await client.post(f"/api/v1/workspaces/{ws_id}/channels", json={"name": "t"}, headers=auth)
    room = chat_service.channel_room(ws_id, ch.json()["id"])

    ok = await client.post("/api/v1/chat/ticket", json={"room_key": room}, headers=auth)
    assert ok.status_code == 200 and ok.json()["ticket"]

    t_out = await _register(client, "nope@nexusbi.io")
    denied = await client.post(
        "/api/v1/chat/ticket", json={"room_key": room}, headers={"Authorization": f"Bearer {t_out}"}
    )
    assert denied.status_code == 404


async def test_resolve_room_access_ws_auth(client: AsyncClient, auth: dict):
    from app.api.v1.ws import _resolve_room_access

    ws_id = await _ws(client, auth)
    ch = await client.post(f"/api/v1/workspaces/{ws_id}/channels", json={"name": "c"}, headers=auth)
    room = chat_service.channel_room(ws_id, ch.json()["id"])
    owner_id = (await _members(client, auth, ws_id))["test@nexusbi.io"]

    # A valid room-bound ticket authenticates the owner.
    res = await _resolve_room_access(room, create_room_ticket(owner_id, room), None)
    assert res is not None and res[0] == owner_id

    # A ticket bound to a DIFFERENT room is rejected (room-claim mismatch).
    other = await _resolve_room_access(room, create_room_ticket(owner_id, "ws:x:channel:y"), None)
    assert other is None

    # A refresh token is not a valid WS credential.
    rt, _ = create_refresh_token(owner_id, "jti", "fam")
    assert await _resolve_room_access(room, None, rt) is None

    # A legit JWT for a non-member is rejected by can_access_room.
    t_out = await _register(client, "ghost@nexusbi.io")
    out_id = (await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {t_out}"})).json()["id"]
    assert await _resolve_room_access(room, None, create_access_token(out_id)) is None

    # A member's JWT works as a fallback.
    ok = await _resolve_room_access(room, None, create_access_token(owner_id))
    assert ok is not None and ok[0] == owner_id


async def test_channel_mention_notifies_member(client: AsyncClient, auth: dict, db_session):
    ws_id = await _ws(client, auth)
    t_m = await _register(client, "m@nexusbi.io", name="Member")
    auth_m = {"Authorization": f"Bearer {t_m}"}
    await _add(client, auth, ws_id, "m@nexusbi.io", "viewer")
    ids = await _members(client, auth, ws_id)
    owner_id = ids["test@nexusbi.io"]

    ch = await client.post(f"/api/v1/workspaces/{ws_id}/channels", json={"name": "genel"}, headers=auth)
    room = chat_service.channel_room(ws_id, ch.json()["id"])

    await chat_service.post_message(db_session, room, owner_id, "Owner", "@m@nexusbi.io bax bura")
    await db_session.commit()

    notifs = (await client.get("/api/v1/notifications", headers=auth_m)).json()
    assert any(n["category"] == "mention" for n in notifs)


async def test_dm_peers_lists_co_members(client: AsyncClient, auth: dict):
    ws_id = await _ws(client, auth)
    await _register(client, "peer@nexusbi.io")
    await _add(client, auth, ws_id, "peer@nexusbi.io", "viewer")

    peers = (await client.get("/api/v1/chat/dm/peers", headers=auth)).json()
    assert any(p["email"] == "peer@nexusbi.io" for p in peers)


async def test_channels_carry_last_message_and_sort_by_activity(
    client: AsyncClient, auth: dict, db_session
):
    ws_id = await _ws(client, auth)
    ids = await _members(client, auth, ws_id)
    owner_id = ids["test@nexusbi.io"]
    ch1 = (
        await client.post(f"/api/v1/workspaces/{ws_id}/channels", json={"name": "birinci"}, headers=auth)
    ).json()["id"]
    ch2 = (
        await client.post(f"/api/v1/workspaces/{ws_id}/channels", json={"name": "ikinci"}, headers=auth)
    ).json()["id"]

    # Activity in ch1 only: a long message that must be truncated for the rail.
    long_text = "x" * 500
    await chat_service.post_message(
        db_session, chat_service.channel_room(ws_id, ch1), owner_id, "Owner", long_text
    )
    await db_session.commit()

    chans = (await client.get(f"/api/v1/workspaces/{ws_id}/channels", headers=auth)).json()
    # The active channel sorts first; the quiet one still lists (creation = activity).
    assert chans[0]["id"] == ch1 and any(c["id"] == ch2 for c in chans)
    preview = chans[0]["last_message"]
    assert preview["author_name"] == "Owner" and len(preview["content"]) == 140
    assert next(c for c in chans if c["id"] == ch2)["last_message"] is None


async def test_dm_peers_carry_unread_and_last_message(client: AsyncClient, auth: dict, db_session):
    ws_id = await _ws(client, auth)
    await _register(client, "dm@nexusbi.io", name="Dima")
    await _add(client, auth, ws_id, "dm@nexusbi.io", "viewer")
    ids = await _members(client, auth, ws_id)
    owner_id, dm_id = ids["test@nexusbi.io"], ids["dm@nexusbi.io"]
    room = chat_service.dm_room(owner_id, dm_id)

    await chat_service.post_message(db_session, room, dm_id, "Dima", "salam, vaxtın var?")
    await db_session.commit()

    peers = (await client.get("/api/v1/chat/dm/peers", headers=auth)).json()
    peer = next(p for p in peers if p["user_id"] == dm_id)
    assert peer["unread"] == 1
    assert peer["last_message"]["content"] == "salam, vaxtın var?"

    # Reading the DM clears the badge.
    await client.post("/api/v1/chat/read", json={"room_key": room}, headers=auth)
    peers2 = (await client.get("/api/v1/chat/dm/peers", headers=auth)).json()
    assert next(p for p in peers2 if p["user_id"] == dm_id)["unread"] == 0
