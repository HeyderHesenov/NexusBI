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

    async def connect(self, room: str, conn: Connection) -> None:
        async with self._lock:
            self._rooms.setdefault(room, set()).add(conn)
        # Newcomer gets the current roster; everyone else hears the join.
        await self._send(conn, {"type": "presence", "participants": self.presence(room)})
        await self.broadcast(
            room, {"type": "join", "participant": asdict(conn.participant)}, exclude=conn
        )

    async def disconnect(self, room: str, conn: Connection) -> None:
        async with self._lock:
            conns = self._rooms.get(room)
            if conns:
                conns.discard(conn)
                if not conns:
                    self._rooms.pop(room, None)
        await self.broadcast(room, {"type": "leave", "conn_id": conn.participant.conn_id})

    async def broadcast(
        self, room: str, message: dict[str, Any], exclude: Connection | None = None
    ) -> None:
        dead: list[Connection] = []
        for c in list(self._rooms.get(room, set())):
            if c is exclude:
                continue
            if not await self._send(c, message):
                dead.append(c)
        if dead:
            async with self._lock:
                conns = self._rooms.get(room)
                if conns:
                    conns.difference_update(dead)

    @staticmethod
    async def _send(conn: Connection, message: dict[str, Any]) -> bool:
        try:
            await conn.ws.send_json(message)
            return True
        except Exception:  # noqa: BLE001 — drop broken sockets silently
            return False


hub = ConnectionHub()
