"""Realtime delivery across workers.

Three things read per-process socket state and are therefore wrong the moment a
second worker exists: `broadcast` (a message reaches only the sender's worker),
`presence` (a room roster shows a fraction of the room) and `online_users` (a
member connected elsewhere looks offline and never gets an unread badge).

The risk being managed here is the reverse failure — a roster that keeps naming
people who left, because presence stopped being derived from a live socket and
started being derived from a record someone has to remember to delete. Hence the
TTL: entries are kept alive by a heartbeat, so a worker that dies takes its
participants with it instead of leaving ghosts.
"""
from __future__ import annotations

import asyncio
import time
import uuid

import pytest

from app.realtime.hub import Connection, Participant


class _RecordingWS:
    def __init__(self) -> None:
        self.sent: list[dict] = []
        self.closed: int | None = None

    async def send_json(self, message: dict) -> None:
        self.sent.append(message)

    async def close(self, code: int = 1000) -> None:
        self.closed = code


def _conn(conn_id: str, user_id: str) -> tuple[_RecordingWS, Connection]:
    ws = _RecordingWS()
    return ws, Connection(
        ws=ws,  # type: ignore[arg-type]
        participant=Participant(conn_id=conn_id, user_id=user_id, name=user_id, color="#000"),
    )


async def _worker(monkeypatch=None):
    from app.realtime.hub import ConnectionHub
    from app.services.cache_service import build_cache_service

    cache = await build_cache_service()
    if not cache.available:
        pytest.skip("Redis unavailable — the realtime bus needs it")
    hub = ConnectionHub()
    hub.bind_cache(cache)
    return hub, cache


async def _two_workers():
    """Two hubs on two Redis connections — the same mechanism two processes use."""
    from app.realtime import bus

    hub_a, cache_a = await _worker()
    hub_b, cache_b = await _worker()
    ready_a, ready_b = asyncio.Event(), asyncio.Event()
    subs = [
        asyncio.create_task(bus.run_room_subscriber(hub_a, cache_a, ready=ready_a)),
        asyncio.create_task(bus.run_room_subscriber(hub_b, cache_b, ready=ready_b)),
    ]
    await asyncio.wait_for(asyncio.gather(ready_a.wait(), ready_b.wait()), timeout=5)
    return hub_a, hub_b, cache_a, cache_b, subs


async def _teardown(caches, subs) -> None:
    for s in subs:
        s.cancel()
    for c in caches:
        await c.aclose()


async def _await(predicate, timeout: float = 5.0, what: str = "delivery") -> None:
    deadline = time.monotonic() + timeout
    while not predicate():
        assert time.monotonic() < deadline, f"{what} never happened"
        await asyncio.sleep(0.02)


@pytest.fixture(autouse=True)
def _bus_on(monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "REALTIME_BUS_ENABLED", True)


@pytest.fixture
def room() -> str:
    return f"testroom-{uuid.uuid4().hex[:8]}"


# ─── Broadcast ───


async def test_a_message_reaches_a_socket_on_another_worker(room):
    hub_a, hub_b, cache_a, cache_b, subs = await _two_workers()
    sock, conn = _conn("c-remote", "u-remote")
    await hub_b.connect(room, conn, announce=False)
    try:
        await hub_a.broadcast(room, {"type": "chat", "text": "salam"})
        await _await(lambda: len(sock.sent) >= 1)
        assert sock.sent[0]["text"] == "salam"
    finally:
        await _teardown((cache_a, cache_b), subs)


async def test_a_local_socket_receives_it_exactly_once(room):
    """Publish-and-also-send-locally is the obvious implementation and double-sends."""
    hub_a, hub_b, cache_a, cache_b, subs = await _two_workers()
    sock, conn = _conn("c-local", "u-local")
    await hub_a.connect(room, conn, announce=False)  # same worker that publishes
    try:
        await hub_a.broadcast(room, {"type": "chat", "text": "bir dəfə"})
        await _await(lambda: len(sock.sent) >= 1)
        await asyncio.sleep(0.3)  # give a duplicate time to show up
        assert len(sock.sent) == 1, sock.sent
    finally:
        await _teardown((cache_a, cache_b), subs)


async def test_exclude_survives_the_round_trip(room):
    """The sender's own socket must stay excluded once `exclude` is a conn id."""
    hub_a, hub_b, cache_a, cache_b, subs = await _two_workers()
    sender_ws, sender = _conn("c-sender", "u-sender")
    other_ws, other = _conn("c-other", "u-other")
    await hub_a.connect(room, sender, announce=False)
    await hub_b.connect(room, other, announce=False)
    try:
        await hub_a.broadcast(room, {"type": "typing"}, exclude=sender)
        await _await(lambda: len(other_ws.sent) >= 1)
        await asyncio.sleep(0.3)
        assert other_ws.sent, "the other participant should have received it"
        assert sender_ws.sent == [], "the excluded sender must not echo"
    finally:
        await _teardown((cache_a, cache_b), subs)


# ─── Presence ───


async def test_the_roster_spans_workers(room):
    hub_a, hub_b, cache_a, cache_b, subs = await _two_workers()
    _, here = _conn("c-here", "u-here")
    _, there = _conn("c-there", "u-there")
    await hub_a.connect(room, here, announce=False)
    await hub_b.connect(room, there, announce=False)
    try:
        names = {p["user_id"] for p in await hub_a.presence(room)}
        assert names == {"u-here", "u-there"}
    finally:
        await _teardown((cache_a, cache_b), subs)


async def test_leaving_removes_you_from_the_roster_everywhere(room):
    hub_a, hub_b, cache_a, cache_b, subs = await _two_workers()
    _, here = _conn("c-here", "u-here")
    _, there = _conn("c-there", "u-there")
    await hub_a.connect(room, here, announce=False)
    await hub_b.connect(room, there, announce=False)
    try:
        await hub_b.disconnect(room, there, announce=False)
        assert {p["user_id"] for p in await hub_a.presence(room)} == {"u-here"}
    finally:
        await _teardown((cache_a, cache_b), subs)


async def test_a_dead_worker_leaves_no_ghosts(room, monkeypatch):
    """The regression this design exists to avoid.

    A worker that crashes cannot run its own cleanup, so presence entries have to
    expire on their own. Otherwise the roster accumulates people who are not there
    and never will be again.
    """
    from app.realtime import hub as hub_module

    monkeypatch.setattr(hub_module, "PRESENCE_TTL_SECONDS", 1)
    hub_a, hub_b, cache_a, cache_b, subs = await _two_workers()
    _, alive = _conn("c-alive", "u-alive")
    _, doomed = _conn("c-doomed", "u-doomed")
    await hub_a.connect(room, alive, announce=False)
    await hub_b.connect(room, doomed, announce=False)
    try:
        assert len(await hub_a.presence(room)) == 2
        # Worker B dies: no disconnect, no further heartbeats.
        for s in subs:
            s.cancel()
        await asyncio.sleep(1.2)
        # A live worker keeps beating for its own, so only the ghost ages out.
        await hub_a.heartbeat_once()
        assert {p["user_id"] for p in await hub_a.presence(room)} == {"u-alive"}
    finally:
        await _teardown((cache_a, cache_b), subs)


async def test_online_users_spans_workers():
    """Unread badges are sized by who is online; per-process that is a lie."""
    from app.realtime import notify

    hub_a, hub_b, cache_a, cache_b, subs = await _two_workers()
    uid = f"u-{uuid.uuid4().hex[:6]}"
    _, mailbox = _conn("c-mb", uid)
    await hub_b.connect(notify.user_room(uid), mailbox, announce=False)
    try:
        assert uid in await hub_a.online_users()
    finally:
        await _teardown((cache_a, cache_b), subs)


# ─── The bus stays optional ───


async def test_with_the_bus_off_delivery_is_local_and_unchanged(room, monkeypatch):
    """A single-worker deployment should not pay a Redis round trip per message."""
    from app.config import settings

    monkeypatch.setattr(settings, "REALTIME_BUS_ENABLED", False)
    hub_a, cache_a = await _worker()
    sock, conn = _conn("c-solo", "u-solo")
    await hub_a.connect(room, conn, announce=False)
    try:
        await hub_a.broadcast(room, {"type": "chat", "text": "lokal"})
        assert sock.sent[0]["text"] == "lokal"  # already delivered, no waiting
        assert {p["user_id"] for p in await hub_a.presence(room)} == {"u-solo"}
    finally:
        await cache_a.aclose()
