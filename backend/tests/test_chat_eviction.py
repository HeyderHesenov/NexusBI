"""Losing access must close the sockets you already have open.

`room_ws` authorises once at connect and never re-checks — every later broadcast
goes to whoever sits in the in-memory room. So removing a member only deleted a
row: their socket kept streaming full message bodies (not previews) until they
happened to disconnect.
"""
from __future__ import annotations

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
