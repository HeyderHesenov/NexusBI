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

from app.core.logging import get_logger

_log = get_logger("nexusbi.realtime")

_USER_PREFIX = "user:"


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

    def presence(self, room: str) -> list[dict[str, Any]]:
        return [asdict(c.participant) for c in self._rooms.get(room, set())]

    def active_rooms(self) -> set[str]:
        """Room ids with at least one live connection (snapshot)."""
        return {room for room, conns in self._rooms.items() if conns}

    async def connect(self, room: str, conn: Connection, *, announce: bool = True) -> None:
        """Join a room. ``announce=False`` skips the presence/join chatter for rooms
        where there is no roster to show — a per-user mailbox is only ever its
        owner's own tabs."""
        async with self._lock:
            self._rooms.setdefault(room, set()).add(conn)
        if not announce:
            return
        # Newcomer gets the current roster; everyone else hears the join.
        await self._send(conn, {"type": "presence", "participants": self.presence(room)})
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
        if announce:
            await self.broadcast(room, {"type": "leave", "conn_id": conn.participant.conn_id})

    async def broadcast(
        self, room: str, message: dict[str, Any], exclude: Connection | None = None
    ) -> None:
        targets = [c for c in self._rooms.get(room, set()) if c is not exclude]
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

    async def evict(self, room_prefix: str, user_ids: set[str] | None = None) -> int:
        """Close live sockets in rooms matching ``room_prefix``, for ``user_ids`` (or
        everyone when None). Returns how many were closed.

        Rooms authorise once, at connect: ``room_ws`` checks access before accepting
        and every later broadcast just goes to whoever is in the set. So losing
        access has to actively hang up, or a removed member keeps receiving full
        message bodies until they happen to disconnect.
        """
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
