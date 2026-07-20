"""notify_service: the single place a Notification is born and delivered."""
from __future__ import annotations

import asyncio

from httpx import AsyncClient

from app.core.notification_types import NotificationCategory
from app.realtime import notify
from app.realtime.hub import Connection, Participant, hub


class _RecordingWS:
    def __init__(self) -> None:
        self.sent: list[dict] = []

    async def send_json(self, message: dict) -> None:
        self.sent.append(message)


async def _mailbox(user_id: str) -> tuple[_RecordingWS, Connection]:
    ws = _RecordingWS()
    conn = Connection(
        ws=ws,  # type: ignore[arg-type]
        participant=Participant(conn_id="c1", user_id=user_id, name="", color=""),
    )
    await hub.connect(notify.user_room(user_id), conn, announce=False)
    return ws, conn


async def _me(client: AsyncClient, auth: dict) -> str:
    return (await client.get("/api/v1/auth/me", headers=auth)).json()["id"]


async def test_notification_reaches_the_mailbox_only_after_commit(
    client: AsyncClient, auth: dict, db_session
):
    """Delivery must ride the commit, not the call: a client that refetches on the
    frame would otherwise race the write and see nothing."""
    from app.services import notify_service

    user_id = await _me(client, auth)
    ws, conn = await _mailbox(user_id)
    try:
        await notify_service.create(
            db_session, user_id, "Başlıq", "mətn", NotificationCategory.INSIGHT
        )
        assert ws.sent == [], "pushed before the row was durable"

        await db_session.commit()
        await asyncio.sleep(0)  # let the after_commit task run
        assert [m["type"] for m in ws.sent] == ["notification"]
        assert ws.sent[0]["title"] == "Başlıq"
        assert ws.sent[0]["category"] == NotificationCategory.INSIGHT
        assert ws.sent[0]["read"] is False
    finally:
        await hub.disconnect(notify.user_room(user_id), conn, announce=False)


async def test_a_rolled_back_notification_is_never_delivered(
    client: AsyncClient, auth: dict, db_session
):
    from app.services import notify_service

    user_id = await _me(client, auth)
    ws, conn = await _mailbox(user_id)
    try:
        await notify_service.create(
            db_session, user_id, "Olmayacaq", "mətn", NotificationCategory.INSIGHT
        )
        await db_session.rollback()
        await asyncio.sleep(0)
        assert ws.sent == []
    finally:
        await hub.disconnect(notify.user_room(user_id), conn, announce=False)


async def test_a_savepoint_rollback_does_not_eat_queued_notifications(
    client: AsyncClient, auth: dict, db_session
):
    """mark_read's upsert unwinds a SAVEPOINT on a concurrent insert. Listening on
    after_soft_rollback (which fires for savepoints too) would silently discard
    notifications queued earlier in the SAME transaction."""
    from datetime import datetime, timezone

    from sqlalchemy.exc import IntegrityError

    from app.models.chat import ChatReadMarker
    from app.services import notify_service

    user_id = await _me(client, auth)
    await notify_service.create(
        db_session, user_id, "Qalmalıdır", "mətn", NotificationCategory.INSIGHT
    )

    now = datetime.now(timezone.utc)
    db_session.add(ChatReadMarker(user_id=user_id, room_key="r", last_read_at=now))
    await db_session.flush()
    try:
        async with db_session.begin_nested():
            db_session.add(ChatReadMarker(user_id=user_id, room_key="r", last_read_at=now))
            await db_session.flush()
    except IntegrityError:
        pass

    ws, conn = await _mailbox(user_id)
    try:
        await db_session.commit()
        await asyncio.sleep(0)
        assert [m["title"] for m in ws.sent] == ["Qalmalıdır"]
    finally:
        await hub.disconnect(notify.user_room(user_id), conn, announce=False)


async def test_long_titles_are_truncated_in_one_place(client: AsyncClient, auth: dict, db_session):
    """`title` is String(255). Only insight_service sliced it — decision_service
    built an unbounded f-string straight into the column."""
    from app.services import notify_service

    user_id = await _me(client, auth)
    row = await notify_service.create(
        db_session, user_id, "x" * 400, "mətn", NotificationCategory.DECISION
    )
    await db_session.commit()
    assert len(row.title) == 255

    notifs = (await client.get("/api/v1/notifications", headers=auth)).json()
    assert any(len(n["title"]) == 255 for n in notifs)


async def test_delivery_is_scoped_to_the_owner(client: AsyncClient, auth: dict, db_session):
    """A notification is per-user; the mailbox room name is the only thing keeping
    one user's alerts out of another's socket."""
    from app.services import notify_service

    user_id = await _me(client, auth)
    other = (
        await client.post(
            "/api/v1/auth/register",
            json={"email": "spy@nexusbi.io", "password": "pw1234", "full_name": "Spy"},
        )
    ).json()["access_token"]
    other_id = await _me(client, {"Authorization": f"Bearer {other}"})

    mine, mine_conn = await _mailbox(user_id)
    theirs, theirs_conn = await _mailbox(other_id)
    try:
        await notify_service.create(
            db_session, user_id, "Yalnız mənim", "mətn", NotificationCategory.KPI_ALERT
        )
        await db_session.commit()
        await asyncio.sleep(0)
        assert len(mine.sent) == 1
        assert theirs.sent == []
    finally:
        await hub.disconnect(notify.user_room(user_id), mine_conn, announce=False)
        await hub.disconnect(notify.user_room(other_id), theirs_conn, announce=False)
