"""Team chat: workspace channels + 1:1 DMs.

Rooms are arbitrary strings (matching the realtime hub): a channel is
``ws:{workspace_id}:channel:{channel_id}`` and a DM is ``dm:{lo}:{hi}`` (the two
user ids, sorted). Access is members-only — there are no share-link guests here.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ForbiddenError, SchemaNotFoundError
from app.core.notification_types import NotificationCategory
from app.models.alert import Notification
from app.models.chat import Channel, ChatMessage, ChatReadMarker
from app.models.user import User
from app.models.workspace import WorkspaceMember
from app.services import workspace_service

_MENTION_RE = re.compile(r"@([\w.+-]+@[\w.-]+|\w[\w.\-]{1,})")
_MAX_MENTIONS = 5


# ─── Room keys ───
def channel_room(workspace_id: str, channel_id: str) -> str:
    return f"ws:{workspace_id}:channel:{channel_id}"


def dm_room(user_a: str, user_b: str) -> str:
    lo, hi = sorted((user_a, user_b))
    return f"dm:{lo}:{hi}"


def _parse_room(room_key: str) -> tuple[str, tuple[str, ...]] | None:
    """('channel', (ws_id, ch_id)) | ('dm', (a, b)) | None if malformed."""
    parts = room_key.split(":")
    if len(parts) == 4 and parts[0] == "ws" and parts[2] == "channel":
        return "channel", (parts[1], parts[3])
    if len(parts) == 3 and parts[0] == "dm":
        return "dm", (parts[1], parts[2])
    return None


async def _co_members(db: AsyncSession, user_a: str, user_b: str) -> bool:
    """True if the two users share at least one workspace (blocks cold DMs)."""
    if user_a == user_b:
        return False
    row = await db.execute(
        select(WorkspaceMember.workspace_id)
        .where(WorkspaceMember.user_id == user_a)
        .where(
            WorkspaceMember.workspace_id.in_(
                select(WorkspaceMember.workspace_id).where(WorkspaceMember.user_id == user_b)
            )
        )
        .limit(1)
    )
    return row.scalar_one_or_none() is not None


async def can_access_room(db: AsyncSession, user_id: str, room_key: str) -> bool:
    parsed = _parse_room(room_key)
    if parsed is None:
        return False
    kind, ids = parsed
    if kind == "channel":
        ws_id, ch_id = ids
        exists = await db.execute(
            select(Channel.id).where(Channel.id == ch_id, Channel.workspace_id == ws_id)
        )
        if exists.scalar_one_or_none() is None:
            return False
        return await workspace_service.get_role(db, ws_id, user_id) is not None
    # DM: the user must be one of the pair, and the two must co-belong to a workspace.
    a, b = ids
    if user_id not in (a, b):
        return False
    return await _co_members(db, a, b)


# ─── Channels ───
async def list_channels(db: AsyncSession, workspace_id: str, user_id: str) -> list[Channel]:
    await workspace_service.require_role(db, workspace_id, user_id, "viewer")
    res = await db.execute(
        select(Channel)
        .where(Channel.workspace_id == workspace_id)
        .order_by(Channel.created_at.asc())
    )
    return list(res.scalars().all())


async def create_channel(
    db: AsyncSession, workspace_id: str, user_id: str, name: str
) -> Channel:
    await workspace_service.require_role(db, workspace_id, user_id, "editor")
    clean = name.strip()[:120]
    if not clean:
        raise ForbiddenError("Kanal adı boş ola bilməz.")
    existing = await db.execute(
        select(Channel.id).where(Channel.workspace_id == workspace_id, Channel.name == clean)
    )
    if existing.scalar_one_or_none() is not None:
        raise ForbiddenError("Bu adda kanal artıq var.")
    channel = Channel(workspace_id=workspace_id, name=clean, created_by=user_id)
    db.add(channel)
    await db.flush()
    await db.refresh(channel)
    return channel


# ─── Messages ───
async def _notify_mentions(
    db: AsyncSession, room_key: str, content: str, author_id: str, author_name: str
) -> None:
    """In-app MENTION notifications for @mentioned users who can access the room.

    Same hardening as dashboard chat: capped, no external fan-out, and only users
    with access to this room are notified (a mention can't ping an outsider)."""
    tokens = list({t.lower() for t in _MENTION_RE.findall(content)})[:_MAX_MENTIONS]
    if not tokens:
        return
    res = await db.execute(
        select(User).where(
            or_(func.lower(User.email).in_(tokens), func.lower(User.full_name).in_(tokens))
        )
    )
    for user in res.scalars().all():
        if user.id == author_id:
            continue
        if not await can_access_room(db, user.id, room_key):
            continue
        db.add(
            Notification(
                user_id=user.id,
                alert_id=None,
                title="Səni qeyd etdilər",
                body=f"{author_name}: {content[:200]}",
                category=NotificationCategory.MENTION,
            )
        )
    await db.flush()


async def post_message(
    db: AsyncSession, room_key: str, author_id: str, author_name: str, content: str
) -> ChatMessage:
    if not await can_access_room(db, author_id, room_key):
        raise SchemaNotFoundError("Otağa giriş yoxdur.")
    text = content.strip()[:2000]
    if not text:
        raise ForbiddenError("Mesaj boş ola bilməz.")
    msg = ChatMessage(
        room_key=room_key, author_id=author_id, author_name=author_name[:120] or "İstifadəçi",
        content=text,
    )
    db.add(msg)
    await db.flush()
    await db.refresh(msg)
    await _notify_mentions(db, room_key, text, author_id, msg.author_name)
    return msg


async def history(
    db: AsyncSession, room_key: str, user_id: str, limit: int = 100
) -> list[ChatMessage]:
    if not await can_access_room(db, user_id, room_key):
        raise SchemaNotFoundError("Otağa giriş yoxdur.")
    # Take the most recent `limit`, returned oldest→newest for display.
    res = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.room_key == room_key)
        .order_by(ChatMessage.created_at.desc())
        .limit(max(1, min(limit, 200)))
    )
    return list(reversed(res.scalars().all()))


# ─── Read markers / unread ───
async def mark_read(db: AsyncSession, user_id: str, room_key: str) -> None:
    if not await can_access_room(db, user_id, room_key):
        raise SchemaNotFoundError("Otağa giriş yoxdur.")
    now = datetime.now(timezone.utc)
    marker = (
        await db.execute(
            select(ChatReadMarker).where(
                ChatReadMarker.user_id == user_id, ChatReadMarker.room_key == room_key
            )
        )
    ).scalar_one_or_none()
    if marker is None:
        db.add(ChatReadMarker(user_id=user_id, room_key=room_key, last_read_at=now))
    else:
        marker.last_read_at = now
    await db.flush()


async def room_summaries(
    db: AsyncSession, user_id: str, room_keys: list[str]
) -> dict[str, tuple[ChatMessage | None, int]]:
    """Per-room (last message, unread count) for a conversation list, in two
    queries regardless of how many rooms are asked for.

    Unread = messages by OTHERS created after the user's read marker (all of
    them when no marker exists). Rooms with no activity are simply absent."""
    if not room_keys:
        return {}
    rn = (
        func.row_number()
        .over(
            partition_by=ChatMessage.room_key,
            order_by=(ChatMessage.created_at.desc(), ChatMessage.id.desc()),
        )
        .label("rn")
    )
    ranked = (
        select(ChatMessage.id, rn).where(ChatMessage.room_key.in_(room_keys)).subquery()
    )
    latest = (
        await db.execute(
            select(ChatMessage).where(
                ChatMessage.id.in_(select(ranked.c.id).where(ranked.c.rn == 1))
            )
        )
    ).scalars()
    out: dict[str, tuple[ChatMessage | None, int]] = {m.room_key: (m, 0) for m in latest}

    unread_rows = await db.execute(
        select(ChatMessage.room_key, func.count())
        .outerjoin(
            ChatReadMarker,
            (ChatReadMarker.room_key == ChatMessage.room_key)
            & (ChatReadMarker.user_id == user_id),
        )
        .where(
            ChatMessage.room_key.in_(room_keys),
            ChatMessage.author_id != user_id,
            or_(
                ChatReadMarker.last_read_at.is_(None),
                ChatMessage.created_at > ChatReadMarker.last_read_at,
            ),
        )
        .group_by(ChatMessage.room_key)
    )
    for room, count in unread_rows:
        last, _ = out.get(room, (None, 0))
        out[room] = (last, int(count))
    return out


async def dm_peers(db: AsyncSession, user_id: str) -> list[User]:
    """Every user who co-belongs to at least one of my workspaces (DM candidates)."""
    my_ws = select(WorkspaceMember.workspace_id).where(WorkspaceMember.user_id == user_id)
    res = await db.execute(
        select(User)
        .join(WorkspaceMember, WorkspaceMember.user_id == User.id)
        .where(WorkspaceMember.workspace_id.in_(my_ws), User.id != user_id)
        .distinct()
    )
    return list(res.scalars().all())
