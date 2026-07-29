"""Delivery of a chat message: to the open room, and to absent members' mailboxes.

One path on purpose. The room broadcast was copy-pasted at three call sites
(ws.py, chat.py, ai_chat_service.py). A fourth producer that forgot the mailbox
fan-out would make the live badge disagree with the unread snapshot — which counts
every message written by someone else, whoever wrote it. Routing all of them
through here keeps "what the snapshot counts" and "what the badge is told about"
the same set by construction, instead of by remembering.
"""
from __future__ import annotations

import asyncio

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.chat import ChatMessage
from app.realtime.hub import _USER_PREFIX, Connection, hub, user_room
from app.schemas.chat import ChatMessageResponse
from app.services import chat_service

# Matches the rail's snippet length (api/v1/chat.py `_SNIPPET_LEN`) so a toast and
# the conversation list never show a differently-truncated version of one message.
_PREVIEW_LEN = 140

__all__ = ["online_users", "publish_message", "user_room"]


async def online_users() -> set[str]:
    """Users with at least one live mailbox socket, across workers when the bus is on.

    Per-process this under-counts the moment a second worker exists: a member
    connected elsewhere reads as offline, and the unread fan-out below skips them
    silently — no badge, no error, nothing to notice.
    """
    return await hub.online_users(_USER_PREFIX)


def _kind(message: ChatMessage) -> str:
    meta = message.meta if isinstance(message.meta, dict) else {}
    # A share card's `content` is a caption or the card title — rendering it as if
    # the author typed it reads as a plain message (and is literally "…" when the
    # card has neither). The client picks a different string for this kind.
    return "share" if meta.get("kind") == "share" else "text"


async def publish_message(
    db: AsyncSession,
    message: ChatMessage,
    *,
    frame: str = "chat",
    exclude: Connection | None = None,
) -> None:
    """Broadcast a message to its room, then badge the members who aren't in it.

    Call AFTER commit: a member refetching history on the frame must not race the
    write. ``frame="chat_update"`` is a status flip on an existing message, not new
    unread, so it stops at the room.
    """
    payload = ChatMessageResponse.model_validate(message).model_dump(mode="json")
    await hub.broadcast(message.room_key, {"type": frame, "message": payload}, exclude=exclude)
    if frame != "chat":
        return

    online = await online_users()
    if not online:
        return  # nobody to tell — and, importantly, no membership query either
    # Sized by who is ONLINE, not by membership: a channel has no seat cap and a
    # `viewer` may post 2 msg/s, so fanning out per member would let the lowest
    # privileged account turn ~300 B/s of input into ~800 KB/s of output.
    targets = await chat_service.message_recipients(
        db, message.room_key, message.author_id, only=online
    )
    if not targets:
        return
    unread = {
        "type": "chat_unread",
        "room_key": message.room_key,
        "message_id": message.id,
        "author_name": message.author_name,
        "kind": _kind(message),
        "preview": message.content[:_PREVIEW_LEN],
        "created_at": payload["created_at"],
    }
    # Concurrently: each broadcast is its own gather, so a loop of awaits would make
    # the poster's send latency scale with the number of recipients.
    await asyncio.gather(*(hub.broadcast(user_room(uid), unread) for uid in targets))
