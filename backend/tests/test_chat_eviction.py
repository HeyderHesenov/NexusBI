"""Losing access must close the sockets you already have open.

`room_ws` authorises once at connect and never re-checks — every later broadcast
goes to whoever sits in the in-memory room. So removing a member only deleted a
row: their socket kept streaming full message bodies (not previews) until they
happened to disconnect.
"""
from __future__ import annotations

import asyncio
import time

import pytest
from httpx import AsyncClient

from app.realtime import notify
from app.realtime.hub import Connection, Participant, hub
from app.services import chat_service


class _RecordingWS:
    def __init__(self) -> None:
        self.sent: list[dict] = []
        self.closed: int | None = None

    async def send_json(self, message: dict) -> None:
        self.sent.append(message)

    async def close(self, code: int = 1000) -> None:
        self.closed = code


async def _join(room: str, user_id: str) -> tuple[_RecordingWS, Connection]:
    ws = _RecordingWS()
    conn = Connection(
        ws=ws,  # type: ignore[arg-type]
        participant=Participant(conn_id=f"c-{user_id[:4]}", user_id=user_id, name="x", color="#000"),
    )
    await hub.connect(room, conn, announce=False)
    return ws, conn


async def _register(client: AsyncClient, email: str) -> str:
    resp = await client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": "pw1234", "full_name": email.split("@")[0]},
    )
    return resp.json()["access_token"]


async def _members(client: AsyncClient, auth: dict, ws_id: str) -> list[dict]:
    return (await client.get(f"/api/v1/workspaces/{ws_id}/members", headers=auth)).json()


async def test_removing_a_member_closes_their_open_room_sockets(
    client: AsyncClient, auth: dict, db_session
):
    ws_id = (
        await client.post("/api/v1/workspaces", json={"name": "Ev"}, headers=auth)
    ).json()["id"]
    await _register(client, "gone@nexusbi.io")
    await client.post(
        f"/api/v1/workspaces/{ws_id}/members",
        json={"email": "gone@nexusbi.io", "role": "viewer"},
        headers=auth,
    )
    members = await _members(client, auth, ws_id)
    gone = next(m for m in members if m["email"] == "gone@nexusbi.io")
    owner = next(m for m in members if m["email"] == "test@nexusbi.io")

    ch_id = (
        await client.post(f"/api/v1/workspaces/{ws_id}/channels", json={"name": "gizli"}, headers=auth)
    ).json()["id"]
    room = chat_service.channel_room(ws_id, ch_id)

    their_ws, their_conn = await _join(room, gone["user_id"])
    owner_ws, owner_conn = await _join(room, owner["user_id"])
    mailbox_ws, mailbox_conn = await _join(notify.user_room(gone["user_id"]), gone["user_id"])

    try:
        resp = await client.delete(
            f"/api/v1/workspaces/{ws_id}/members/{gone['id']}", headers=auth
        )
        assert resp.status_code in (200, 204), resp.text

        # Their channel socket is gone; the remaining member keeps theirs.
        assert their_ws.closed == 4403
        assert their_conn not in hub._rooms.get(room, set())
        assert owner_conn in hub._rooms.get(room, set())
        assert owner_ws.closed is None

        # The mailbox is identity-scoped, not workspace-scoped — it stays, and the
        # fan-out simply stops naming them (message_recipients re-reads membership).
        assert mailbox_ws.closed is None
        assert await chat_service.message_recipients(db_session, room, owner["user_id"]) == []
    finally:
        for r, c in (
            (room, their_conn),
            (room, owner_conn),
            (notify.user_room(gone["user_id"]), mailbox_conn),
        ):
            await hub.disconnect(r, c, announce=False)


async def test_deleting_a_workspace_closes_every_channel_socket(client: AsyncClient, auth: dict):
    ws_id = (
        await client.post("/api/v1/workspaces", json={"name": "Silinən"}, headers=auth)
    ).json()["id"]
    owner = next(m for m in await _members(client, auth, ws_id) if m["email"] == "test@nexusbi.io")
    ch_id = (
        await client.post(f"/api/v1/workspaces/{ws_id}/channels", json={"name": "k"}, headers=auth)
    ).json()["id"]
    room = chat_service.channel_room(ws_id, ch_id)
    sock, conn = await _join(room, owner["user_id"])

    try:
        resp = await client.delete(f"/api/v1/workspaces/{ws_id}", headers=auth)
        assert resp.status_code in (200, 204), resp.text
        assert sock.closed == 4403
        assert room not in hub._rooms
    finally:
        await hub.disconnect(room, conn, announce=False)


# ─── Across workers ───
#
# Rooms live in each worker's own memory, so evicting only ever closed the
# sockets that happened to land on the process handling the DELETE. A member
# removed from a workspace kept receiving full message bodies on every other
# worker — the room's authorisation was never re-checked, and nothing told those
# workers to hang up. Membership is a security boundary, so it has to cross.


async def _two_workers():
    """Two ConnectionHubs on one Redis, standing in for two uvicorn processes."""
    from app.realtime import bus
    from app.realtime.hub import ConnectionHub
    from app.services.cache_service import build_cache_service

    cache_a = await build_cache_service()
    if not cache_a.available:
        pytest.skip("Redis unavailable — cross-worker eviction needs the bus")
    cache_b = await build_cache_service()
    worker_a, worker_b = ConnectionHub(), ConnectionHub()
    worker_a.bind_cache(cache_a)
    worker_b.bind_cache(cache_b)

    ready = asyncio.Event()
    sub = asyncio.create_task(bus.run_evict_subscriber(worker_b, cache_b, ready=ready))
    await asyncio.wait_for(ready.wait(), timeout=5)
    return worker_a, worker_b, cache_a, cache_b, sub


async def _await_close(sock, timeout: float = 5.0) -> None:
    """Wait for the bus to deliver. asyncio.timeout is 3.11+; this runs on 3.10."""
    deadline = time.monotonic() + timeout
    while sock.closed is None:
        assert time.monotonic() < deadline, "eviction never reached the other worker"
        await asyncio.sleep(0.02)


async def test_eviction_closes_sockets_held_by_another_worker():
    worker_a, worker_b, cache_a, cache_b, sub = await _two_workers()
    room = "ws:W1:channel:C1"

    victim = _RecordingWS()
    victim_conn = Connection(
        ws=victim,  # type: ignore[arg-type]
        participant=Participant(conn_id="c1", user_id="gone-user", name="x", color="#000"),
    )
    bystander = _RecordingWS()
    bystander_conn = Connection(
        ws=bystander,  # type: ignore[arg-type]
        participant=Participant(conn_id="c2", user_id="stays-user", name="y", color="#000"),
    )
    # Both connected to worker B; the removal is handled by worker A.
    await worker_b.connect(room, victim_conn, announce=False)
    await worker_b.connect(room, bystander_conn, announce=False)

    try:
        assert await worker_a.evict("ws:W1:channel:", {"gone-user"}) == 0  # none local to A
        await _await_close(victim)
        assert victim.closed == 4403
        assert victim_conn not in worker_b._rooms.get(room, set())
        # Everyone else on that worker keeps their socket.
        assert bystander.closed is None
        assert bystander_conn in worker_b._rooms.get(room, set())
    finally:
        sub.cancel()
        await worker_b.disconnect(room, bystander_conn, announce=False)
        await cache_a.aclose()
        await cache_b.aclose()


async def test_evicting_a_whole_workspace_crosses_workers():
    """Deleting a workspace must hang up its channels everywhere, not just here."""
    worker_a, worker_b, cache_a, cache_b, sub = await _two_workers()
    room = "ws:W2:channel:C9"
    other_room = "ws:OTHER:channel:C9"

    sock = _RecordingWS()
    conn = Connection(
        ws=sock,  # type: ignore[arg-type]
        participant=Participant(conn_id="c3", user_id="u3", name="z", color="#000"),
    )
    untouched = _RecordingWS()
    untouched_conn = Connection(
        ws=untouched,  # type: ignore[arg-type]
        participant=Participant(conn_id="c4", user_id="u4", name="w", color="#000"),
    )
    await worker_b.connect(room, conn, announce=False)
    await worker_b.connect(other_room, untouched_conn, announce=False)

    try:
        await worker_a.evict("ws:W2:channel:")  # user_ids=None → everyone in the prefix
        await _await_close(sock)
        assert sock.closed == 4403
        # A different workspace's room is not in the prefix and must survive.
        assert untouched.closed is None
    finally:
        sub.cancel()
        await worker_b.disconnect(other_room, untouched_conn, announce=False)
        await cache_a.aclose()
        await cache_b.aclose()


async def test_eviction_still_works_without_redis():
    """No bus is single-process behaviour, not a disabled security control."""
    from app.realtime.hub import ConnectionHub

    solo = ConnectionHub()  # no cache bound
    room = "ws:W3:channel:C1"
    sock = _RecordingWS()
    conn = Connection(
        ws=sock,  # type: ignore[arg-type]
        participant=Participant(conn_id="c5", user_id="u5", name="s", color="#000"),
    )
    await solo.connect(room, conn, announce=False)
    assert await solo.evict("ws:W3:channel:", {"u5"}) == 1
    assert sock.closed == 4403
