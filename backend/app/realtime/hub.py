"""In-process pub/sub hub for dashboard collaboration (cursors + chat).

Single-process only: rooms live in memory. For multi-worker deployments this
would need a shared bus (e.g. Redis pub/sub) — out of scope for the single
uvicorn process this app runs as.
"""
from __future__ import annotations

import asyncio
from dataclasses import asdict, dataclass
from typing import Any

from fastapi import WebSocket

from app.config import settings
from app.core.logging import get_logger

_log = get_logger("nexusbi.realtime")

_USER_PREFIX = "user:"

# How long a presence record survives without a heartbeat. Three beats of slack,
# so a GC pause or a slow tick does not blink a live participant out of the room.
PRESENCE_TTL_SECONDS = 45
PRESENCE_HEARTBEAT_SECONDS = 15


def user_room(user_id: str) -> str:
    """A user's private mailbox room.

    The room namespace is flat and shared with dashboard rooms (raw uuids) and chat
    rooms (``ws:`` / ``dm:`` / ``ai:``), so this prefix is what keeps them apart. It
    is deliberately unreachable as a chat room: ``chat_service._parse_room`` has no
    ``user:`` grammar, so it returns None and ``can_access_room`` refuses.
    """
    return f"{_USER_PREFIX}{user_id}"


@dataclass
class Participant:
    conn_id: str
    user_id: str | None
    name: str
    color: str


@dataclass(eq=False)  # identity-based hashing so Connection can live in a set
class Connection:
    ws: WebSocket
    participant: Participant


class ConnectionHub:
    def __init__(self) -> None:
        self._rooms: dict[str, set[Connection]] = {}
        self._lock = asyncio.Lock()
        # Set at startup when Redis is reachable. Eviction always uses it; delivery
        # and presence use it only when REALTIME_BUS_ENABLED — see `realtime.bus`.
        self._cache: Any | None = None

    def bind_cache(self, cache: Any | None) -> None:
        """Attach the app-wide cache so this hub can reach other workers."""
        self._cache = cache

    def _bus_on(self) -> bool:
        return (
            settings.REALTIME_BUS_ENABLED
            and self._cache is not None
            and getattr(self._cache, "available", False)
        )

    async def presence(self, room: str) -> list[dict[str, Any]]:
        """The room roster. Spans workers when the bus is on."""
        if self._bus_on():
            from app.realtime import bus

            return await bus.read_presence(self._cache, room, PRESENCE_TTL_SECONDS)
        return self._presence_local(room)

    def _presence_local(self, room: str) -> list[dict[str, Any]]:
        return [asdict(c.participant) for c in self._rooms.get(room, set())]

    def active_rooms(self) -> set[str]:
        """Room ids with at least one connection ON THIS WORKER (snapshot)."""
        return {room for room, conns in self._rooms.items() if conns}

    async def online_users(self, prefix: str = _USER_PREFIX) -> set[str]:
        """User ids with a live mailbox socket, across workers when the bus is on.

        Unread fan-out is sized by who is online, so per-process this under-counts:
        a member connected to another worker looks offline and silently never gets
        their badge.
        """
        if self._bus_on():
            from app.realtime import bus

            return await bus.read_online_users(self._cache, PRESENCE_TTL_SECONDS)
        return {r[len(prefix):] for r in self.active_rooms() if r.startswith(prefix)}

    async def connect(self, room: str, conn: Connection, *, announce: bool = True) -> None:
        """Join a room. ``announce=False`` skips the presence/join chatter for rooms
        where there is no roster to show — a per-user mailbox is only ever its
        owner's own tabs."""
        async with self._lock:
            self._rooms.setdefault(room, set()).add(conn)
        if self._bus_on():
            from app.realtime import bus

            await bus.register_presence(self._cache, room, conn.participant)
        if not announce:
            return
        # Newcomer gets the current roster; everyone else hears the join.
        await self._send(conn, {"type": "presence", "participants": await self.presence(room)})
        await self.broadcast(
            room, {"type": "join", "participant": asdict(conn.participant)}, exclude=conn
        )

    async def disconnect(self, room: str, conn: Connection, *, announce: bool = True) -> None:
        async with self._lock:
            conns = self._rooms.get(room)
            if conns:
                conns.discard(conn)
                if not conns:
                    self._rooms.pop(room, None)
        if self._bus_on():
            from app.realtime import bus

            await bus.forget_presence(self._cache, room, conn.participant)
        if announce:
            await self.broadcast(room, {"type": "leave", "conn_id": conn.participant.conn_id})

    async def broadcast(
        self, room: str, message: dict[str, Any], exclude: Connection | None = None
    ) -> None:
        """Deliver to a room. Crosses workers when the bus is on.

        With the bus on this ONLY publishes — the subscriber does every delivery,
        including on this worker. Sending locally *and* publishing is the obvious
        implementation and delivers twice to whoever is connected here.
        """
        if self._bus_on():
            from app.realtime import bus

            exclude_id = exclude.participant.conn_id if exclude else None
            await bus.publish_room(self._cache, room, message, exclude_id)
            return
        await self.deliver_local(
            room, message, exclude_conn_id=exclude.participant.conn_id if exclude else None
        )

    async def deliver_local(
        self, room: str, message: dict[str, Any], exclude_conn_id: str | None = None
    ) -> None:
        """Write to the sockets THIS process holds. The only place a socket is written."""
        targets = [
            c
            for c in self._rooms.get(room, set())
            if exclude_conn_id is None or c.participant.conn_id != exclude_conn_id
        ]
        if not targets:
            return
        # Fan out concurrently so one slow/stuck socket can't stall the room.
        results = await asyncio.gather(*(self._send(c, message) for c in targets))
        dead = [c for c, ok in zip(targets, results) if not ok]
        if dead:
            async with self._lock:
                conns = self._rooms.get(room)
                if conns:
                    conns.difference_update(dead)

    async def heartbeat_once(self) -> None:
        """Refresh the TTL on every presence entry this worker is responsible for.

        Presence is a record, not a live socket, so something has to keep saying
        "still here". A worker that dies stops saying it and its participants age
        out — which is what stops the roster filling with ghosts.
        """
        if not self._bus_on():
            return
        from app.realtime import bus

        async with self._lock:
            snapshot = {room: list(conns) for room, conns in self._rooms.items()}
        for room, conns in snapshot.items():
            for conn in conns:
                await bus.register_presence(self._cache, room, conn.participant)

    async def evict(self, room_prefix: str, user_ids: set[str] | None = None) -> int:
        """Close live sockets in rooms matching ``room_prefix``, for ``user_ids`` (or
        everyone when None). Returns how many were closed **on this worker**.

        Rooms authorise once, at connect: ``room_ws`` checks access before accepting
        and every later broadcast just goes to whoever is in the set. So losing
        access has to actively hang up, or a removed member keeps receiving full
        message bodies until they happen to disconnect.

        Rooms are per-process, so closing locally only covers the sockets that
        happened to land on the worker handling the request. The published command
        is what makes the other workers hang up too; without Redis there is only
        one worker and local is complete. The return value stays local on purpose —
        it counts what this process did, not what the cluster will do.
        """
        closed = await self.evict_local(room_prefix, user_ids)
        from app.realtime import bus

        await bus.publish_evict(self._cache, room_prefix, user_ids)
        return closed

    async def evict_local(self, room_prefix: str, user_ids: set[str] | None = None) -> int:
        """Close matching sockets held by THIS process. Idempotent."""
        doomed: list[tuple[str, Connection]] = []
        async with self._lock:
            for room, conns in self._rooms.items():
                if not room.startswith(room_prefix):
                    continue
                for conn in conns:
                    if user_ids is None or conn.participant.user_id in user_ids:
                        doomed.append((room, conn))
        for room, conn in doomed:
            try:
                await conn.ws.close(code=4403)
            except Exception:  # noqa: BLE001 — already-dead socket, drop it anyway
                pass
            await self.disconnect(room, conn, announce=False)
        return len(doomed)

    @staticmethod
    async def _send(conn: Connection, message: dict[str, Any]) -> bool:
        try:
            await conn.ws.send_json(message)
            return True
        except Exception:  # noqa: BLE001 — drop broken sockets silently
            return False


hub = ConnectionHub()
