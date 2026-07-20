"""Team chat: channels, room access, DM rules, tickets, unread, WS auth."""
from __future__ import annotations

from httpx import AsyncClient
from sqlalchemy import select

from app.core.security import create_access_token, create_refresh_token, create_room_ticket
from app.models.chat import ChatReadMarker
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


async def test_message_posted_right_after_mark_read_stays_unread(
    client: AsyncClient, auth: dict, db_session
):
    """A message landing in the same wall-clock second as mark_read must still count.

    ``created_at`` comes from the DB clock (``server_default=func.now()``, base.py)
    while the marker used to come from the app clock. On SQLite ``CURRENT_TIMESTAMP``
    floors to the second, so a message posted up to 999ms AFTER the read lost the
    ``created_at > last_read_at`` comparison and was born already-read.
    """
    ws_id = await _ws(client, auth)
    await _register(client, "clock@nexusbi.io")
    await _add(client, auth, ws_id, "clock@nexusbi.io", "editor")
    ed_id = (await _members(client, auth, ws_id))["clock@nexusbi.io"]
    ch_id = (
        await client.post(f"/api/v1/workspaces/{ws_id}/channels", json={"name": "saat"}, headers=auth)
    ).json()["id"]
    room = chat_service.channel_room(ws_id, ch_id)

    # Owner reads the room, then a message lands immediately after — same second.
    assert (
        await client.post("/api/v1/chat/read", json={"room_key": room}, headers=auth)
    ).status_code == 204
    await chat_service.post_message(db_session, room, ed_id, "Ed", "indi gəldi")
    await db_session.commit()

    chans = (await client.get(f"/api/v1/workspaces/{ws_id}/channels", headers=auth)).json()
    assert next(c for c in chans if c["id"] == ch_id)["unread"] == 1


async def _marker(db_session, user_id: str, room: str):
    return (
        await db_session.execute(
            select(ChatReadMarker.last_read_at).where(
                ChatReadMarker.user_id == user_id, ChatReadMarker.room_key == room
            )
        )
    ).scalar_one_or_none()


async def test_mark_read_marker_never_moves_backwards(client: AsyncClient, auth: dict, db_session):
    """An out-of-order mark_read must not resurrect already-read messages."""
    from datetime import timedelta, timezone

    ws_id = await _ws(client, auth)
    await _register(client, "back@nexusbi.io")
    await _add(client, auth, ws_id, "back@nexusbi.io", "editor")
    ids = await _members(client, auth, ws_id)
    owner_id, ed_id = ids["test@nexusbi.io"], ids["back@nexusbi.io"]
    ch_id = (
        await client.post(f"/api/v1/workspaces/{ws_id}/channels", json={"name": "geri"}, headers=auth)
    ).json()["id"]
    room = chat_service.channel_room(ws_id, ch_id)

    msg = await chat_service.post_message(db_session, room, ed_id, "Ed", "birinci")
    await db_session.commit()
    seen = msg.created_at.replace(tzinfo=timezone.utc)

    await chat_service.mark_read(db_session, owner_id, room, up_to=seen)
    await chat_service.mark_read(db_session, owner_id, room, up_to=seen - timedelta(hours=1))
    await db_session.commit()

    assert (await _marker(db_session, owner_id, room)).replace(tzinfo=timezone.utc) == seen


async def test_mark_read_is_idempotent_under_concurrency(
    client: AsyncClient, auth: dict, db_session
):
    """Concurrent first-time mark_reads must not 500 on uq_read_marker."""
    import asyncio

    ws_id = await _ws(client, auth)
    await _register(client, "race@nexusbi.io")
    await _add(client, auth, ws_id, "race@nexusbi.io", "editor")
    ed_id = (await _members(client, auth, ws_id))["race@nexusbi.io"]
    ch_id = (
        await client.post(f"/api/v1/workspaces/{ws_id}/channels", json={"name": "yaris"}, headers=auth)
    ).json()["id"]
    room = chat_service.channel_room(ws_id, ch_id)
    await chat_service.post_message(db_session, room, ed_id, "Ed", "salam")
    await db_session.commit()

    results = await asyncio.gather(
        *(client.post("/api/v1/chat/read", json={"room_key": room}, headers=auth) for _ in range(4))
    )
    assert [r.status_code for r in results] == [204, 204, 204, 204]


async def test_mark_read_clamps_up_to_to_a_real_message(
    client: AsyncClient, auth: dict, db_session
):
    """A far-future up_to must be clamped to the newest message that really exists,
    otherwise one bad request would silence the room forever."""
    from datetime import datetime, timedelta, timezone

    ws_id = await _ws(client, auth)
    await _register(client, "future@nexusbi.io")
    await _add(client, auth, ws_id, "future@nexusbi.io", "editor")
    ids = await _members(client, auth, ws_id)
    owner_id, ed_id = ids["test@nexusbi.io"], ids["future@nexusbi.io"]
    ch_id = (
        await client.post(f"/api/v1/workspaces/{ws_id}/channels", json={"name": "gelecek"}, headers=auth)
    ).json()["id"]
    room = chat_service.channel_room(ws_id, ch_id)

    msg = await chat_service.post_message(db_session, room, ed_id, "Ed", "real mesaj")
    await db_session.commit()

    far_future = (datetime.now(timezone.utc) + timedelta(days=3650)).isoformat()
    assert (
        await client.post(
            "/api/v1/chat/read", json={"room_key": room, "up_to": far_future}, headers=auth
        )
    ).status_code == 204

    stored = (await _marker(db_session, owner_id, room)).replace(tzinfo=timezone.utc)
    assert stored == msg.created_at.replace(tzinfo=timezone.utc)


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


async def test_non_canonical_dm_room_key_is_refused(client: AsyncClient, auth: dict, db_session):
    """dm_room() sorts the pair, but nothing enforced that on the read path — so
    dm:{hi}:{lo} was a second, fully-authorised alias for every DM. The frontend
    can never build it, so it is a room only an attacker can address: messages
    posted there are invisible in the rail yet still fan out to the victim."""
    ws_id = await _ws(client, auth)
    for e in ("x@nexusbi.io", "y@nexusbi.io"):
        await _register(client, e)
        await _add(client, auth, ws_id, e, "viewer")
    ids = await _members(client, auth, ws_id)
    lo, hi = sorted((ids["x@nexusbi.io"], ids["y@nexusbi.io"]))

    assert await chat_service.can_access_room(db_session, lo, f"dm:{lo}:{hi}") is True
    assert await chat_service.can_access_room(db_session, lo, f"dm:{hi}:{lo}") is False
    assert await chat_service.can_access_room(db_session, hi, f"dm:{hi}:{lo}") is False


async def test_scoped_tickets_are_not_bearer_access_tokens(client: AsyncClient, auth: dict):
    """A scoped credential must never authenticate the REST API. get_current_user
    denied rt/ws/emb but not `room`, so a 60s /chat/ticket token was a valid Bearer."""
    from app.core.security import create_embed_token, create_ws_ticket

    ws_id = await _ws(client, auth)
    owner_id = (await _members(client, auth, ws_id))["test@nexusbi.io"]
    ch_id = (
        await client.post(f"/api/v1/workspaces/{ws_id}/channels", json={"name": "b"}, headers=auth)
    ).json()["id"]
    room = chat_service.channel_room(ws_id, ch_id)

    rt, _ = create_refresh_token(owner_id, "jti", "fam")
    for cred in (
        create_room_ticket(owner_id, room),
        create_ws_ticket(owner_id, "dash-1"),
        create_embed_token("dash-1"),
        rt,
    ):
        resp = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {cred}"})
        assert resp.status_code == 401, f"scoped credential accepted as Bearer: {resp.text}"

    # A genuine access token still works.
    ok = await client.get(
        "/api/v1/auth/me", headers={"Authorization": f"Bearer {create_access_token(owner_id)}"}
    )
    assert ok.status_code == 200


async def test_ws_token_fallback_rejects_scoped_tickets(client: AsyncClient, auth: dict):
    """The unscoped `?token=` slot skipped the claim binding entirely — only `rt`
    was filtered. So a ticket minted for room A was a general credential for every
    room its holder could reach, and a dashboard ticket worked on a chat room."""
    from app.api.v1.ws import _resolve_room_access
    from app.core.security import create_ws_ticket

    ws_id = await _ws(client, auth)
    owner_id = (await _members(client, auth, ws_id))["test@nexusbi.io"]
    a_id = (
        await client.post(f"/api/v1/workspaces/{ws_id}/channels", json={"name": "a"}, headers=auth)
    ).json()["id"]
    b_id = (
        await client.post(f"/api/v1/workspaces/{ws_id}/channels", json={"name": "b"}, headers=auth)
    ).json()["id"]
    room_a = chat_service.channel_room(ws_id, a_id)
    room_b = chat_service.channel_room(ws_id, b_id)

    # A room-A ticket replayed through ?token= must not unlock room B.
    assert await _resolve_room_access(room_b, None, create_room_ticket(owner_id, room_a)) is None
    # A dashboard ticket is not a chat credential.
    assert await _resolve_room_access(room_b, None, create_ws_ticket(owner_id, "dash-1")) is None


async def test_user_mailbox_ticket_is_self_bound(client: AsyncClient, auth: dict):
    """The mailbox ticket names its own holder's room, so it cannot be aimed at
    anyone else — and it is inert on every other surface."""
    from app.api.v1.ws import _resolve_room_access, _resolve_user_access
    from app.realtime import notify

    ws_id = await _ws(client, auth)
    t_other = await _register(client, "mb@nexusbi.io")
    ids = await _members(client, auth, ws_id)
    owner_id = ids["test@nexusbi.io"]
    other_id = (
        await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {t_other}"})
    ).json()["id"]

    ticket = (await client.post("/api/v1/chat/user-ticket", headers=auth)).json()["ticket"]
    assert await _resolve_user_access(ticket) == owner_id

    # A ticket minted for someone else's mailbox resolves to THEM, never to the
    # presenter — and one hand-forged for a victim's room fails the self-binding.
    forged = create_room_ticket(owner_id, notify.user_room(other_id))
    assert await _resolve_user_access(forged) is None

    # A mailbox ticket is not a chat-room credential, in either slot.
    ch_id = (
        await client.post(f"/api/v1/workspaces/{ws_id}/channels", json={"name": "mb"}, headers=auth)
    ).json()["id"]
    room = chat_service.channel_room(ws_id, ch_id)
    assert await _resolve_room_access(room, ticket, None) is None
    assert await _resolve_room_access(room, None, ticket) is None
    # ...nor is it addressable as a chat room at all.
    assert await _resolve_room_access(notify.user_room(owner_id), ticket, None) is None

    # A room ticket is not a mailbox credential either.
    assert await _resolve_user_access(create_room_ticket(owner_id, room)) is None
    assert await _resolve_user_access(create_access_token(owner_id)) is None


async def test_user_mailbox_room_is_not_a_chat_room(client: AsyncClient, auth: dict, db_session):
    """The hub namespace is flat, so `user:` keys must have no chat-room grammar."""
    from app.realtime import notify

    ws_id = await _ws(client, auth)
    owner_id = (await _members(client, auth, ws_id))["test@nexusbi.io"]
    mailbox = notify.user_room(owner_id)

    assert await chat_service.can_access_room(db_session, owner_id, mailbox) is False
    denied = await client.post("/api/v1/chat/ticket", json={"room_key": mailbox}, headers=auth)
    assert denied.status_code == 404


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


async def test_unread_overview_spans_channels_and_never_opened_dms(
    client: AsyncClient, auth: dict, db_session
):
    """The global badge must see every room, including a DM the user has never
    opened — that's exactly the "someone messaged you while you were away" case."""
    ws_id = await _ws(client, auth)
    await _register(client, "ov@nexusbi.io")
    await _add(client, auth, ws_id, "ov@nexusbi.io", "editor")
    ids = await _members(client, auth, ws_id)
    owner_id, ov_id = ids["test@nexusbi.io"], ids["ov@nexusbi.io"]

    ch_id = (
        await client.post(f"/api/v1/workspaces/{ws_id}/channels", json={"name": "ic"}, headers=auth)
    ).json()["id"]
    channel = chat_service.channel_room(ws_id, ch_id)
    dm = chat_service.dm_room(owner_id, ov_id)

    await chat_service.post_message(db_session, channel, ov_id, "Ov", "kanalda")
    await chat_service.post_message(db_session, dm, ov_id, "Ov", "dm-də birinci")
    await chat_service.post_message(db_session, dm, ov_id, "Ov", "dm-də ikinci")
    # The owner's own message must never count toward their own unread.
    await chat_service.post_message(db_session, channel, owner_id, "Owner", "özüm")
    await db_session.commit()

    rooms = await chat_service.unread_overview(db_session, owner_id)
    assert {r: v["unread"] for r, v in rooms.items()} == {channel: 1, dm: 2}
    # Each room carries the cutoff this snapshot saw, so a client can tell an
    # already-counted live frame from one that landed after the query ran.
    assert rooms[dm]["at"] and rooms[channel]["at"]

    # Reading the DM drops it out of the overview entirely.
    await chat_service.mark_read(db_session, owner_id, dm)
    await db_session.commit()
    after = await chat_service.unread_overview(db_session, owner_id)
    assert {r: v["unread"] for r, v in after.items()} == {channel: 1}


async def test_unread_counts_only_messages_newer_than_the_marker(
    client: AsyncClient, auth: dict, db_session
):
    """Marker-first counting: a room with a marker counts only its unread tail."""
    from datetime import timedelta, timezone

    ws_id = await _ws(client, auth)
    await _register(client, "tail@nexusbi.io")
    await _add(client, auth, ws_id, "tail@nexusbi.io", "editor")
    ids = await _members(client, auth, ws_id)
    owner_id, ed_id = ids["test@nexusbi.io"], ids["tail@nexusbi.io"]
    ch_id = (
        await client.post(f"/api/v1/workspaces/{ws_id}/channels", json={"name": "quyruq"}, headers=auth)
    ).json()["id"]
    room = chat_service.channel_room(ws_id, ch_id)

    old = await chat_service.post_message(db_session, room, ed_id, "Ed", "köhnə")
    await db_session.commit()
    # Two messages that are unambiguously newer than the marker, whatever the
    # DB clock's resolution.
    for text in ("yeni bir", "yeni iki"):
        msg = await chat_service.post_message(db_session, room, ed_id, "Ed", text)
        msg.created_at = _utc_naive(old.created_at + timedelta(minutes=5))
    await db_session.commit()

    await chat_service.mark_read(
        db_session, owner_id, room, up_to=old.created_at.replace(tzinfo=timezone.utc)
    )
    await db_session.commit()

    overview = await chat_service.unread_overview(db_session, owner_id)
    assert {r: v["unread"] for r, v in overview.items()} == {room: 2}


def _utc_naive(value):
    return value.replace(tzinfo=None) if value.tzinfo else value


async def test_message_recipients_by_room_kind(client: AsyncClient, auth: dict, db_session):
    """Fan-out targets must come from the same authority as can_access_room
    (workspace membership) or they drift into a leak."""
    ws_id = await _ws(client, auth)
    for e in ("r1@nexusbi.io", "r2@nexusbi.io"):
        await _register(client, e)
        await _add(client, auth, ws_id, e, "viewer")
    ids = await _members(client, auth, ws_id)
    owner_id, r1, r2 = ids["test@nexusbi.io"], ids["r1@nexusbi.io"], ids["r2@nexusbi.io"]

    ch_id = (
        await client.post(f"/api/v1/workspaces/{ws_id}/channels", json={"name": "f"}, headers=auth)
    ).json()["id"]
    channel = chat_service.channel_room(ws_id, ch_id)

    # Channel: every member except the author.
    got = await chat_service.message_recipients(db_session, channel, owner_id)
    assert sorted(got) == sorted([r1, r2])

    # DM: only the peer, never the author.
    dm = chat_service.dm_room(owner_id, r1)
    assert await chat_service.message_recipients(db_session, dm, owner_id) == [r1]
    assert await chat_service.message_recipients(db_session, dm, r1) == [owner_id]

    # The personal AI room notifies nobody — its owner is the one reading it.
    assert await chat_service.message_recipients(db_session, chat_service.ai_room(owner_id), owner_id) == []

    # `only` narrows to who actually has a live mailbox, so fan-out is sized by
    # who is online rather than by workspace size.
    assert await chat_service.message_recipients(db_session, channel, owner_id, only={r2}) == [r2]
    assert await chat_service.message_recipients(db_session, channel, owner_id, only=set()) == []


async def test_every_message_the_snapshot_counts_is_also_fanned_out(
    client: AsyncClient, auth: dict, db_session
):
    """THE invariant. The badge has two producers — the snapshot query and the live
    fan-out — and they must agree about every message or the number drifts.

    The AI is the trap: is_ai_trigger fires in CHANNELS, and post_assistant_message
    writes a real author_id, so unread_counts counts assistant replies like any
    other. Carving the AI out of fan-out (tempting: "the AI isn't a teammate") makes
    the badge silently contradict itself until the next reconnect.
    """
    from app.services import ai_chat_service

    ws_id = await _ws(client, auth)
    await _register(client, "inv@nexusbi.io")
    await _add(client, auth, ws_id, "inv@nexusbi.io", "editor")
    ids = await _members(client, auth, ws_id)
    owner_id, inv_id = ids["test@nexusbi.io"], ids["inv@nexusbi.io"]
    ch_id = (
        await client.post(f"/api/v1/workspaces/{ws_id}/channels", json={"name": "inv"}, headers=auth)
    ).json()["id"]
    channel = chat_service.channel_room(ws_id, ch_id)

    human = await chat_service.post_message(db_session, channel, inv_id, "Inv", "insan mesajı")
    ai_msg = await ai_chat_service.post_assistant_message(
        db_session, channel, "ai cavabı", {"ai": True, "kind": "actions"}
    )
    await db_session.commit()

    counted = await chat_service.unread_overview(db_session, owner_id)
    assert counted[channel]["unread"] == 2, "snapshot must count the human AND the AI reply"

    for msg in (human, ai_msg):
        targets = await chat_service.message_recipients(db_session, channel, msg.author_id)
        assert owner_id in targets, f"snapshot counts {msg.content!r} but fan-out skips it"


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
