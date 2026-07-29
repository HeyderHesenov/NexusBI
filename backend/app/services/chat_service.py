"""Team chat: workspace channels + 1:1 DMs.

Rooms are arbitrary strings (matching the realtime hub): a channel is
``ws:{workspace_id}:channel:{channel_id}`` and a DM is ``dm:{lo}:{hi}`` (the two
user ids, sorted). Access is members-only — there are no share-link guests here.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone

from sqlalchemy import and_, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.billing.tiers import has_ai_chat
from app.core.exceptions import ForbiddenError, SchemaNotFoundError
from app.core.notification_types import NotificationCategory
from app.models.chat import Channel, ChatMessage, ChatReadMarker
from app.models.user import User
from app.models.workspace import WorkspaceMember
from app.services import notify_service, workspace_service

_MENTION_RE = re.compile(r"@([\w.+-]+@[\w.-]+|\w[\w.\-]{1,})")
_MAX_MENTIONS = 5


# ─── Room keys ───
def channel_room(workspace_id: str, channel_id: str) -> str:
    return f"ws:{workspace_id}:channel:{channel_id}"


def dm_room(user_a: str, user_b: str) -> str:
    lo, hi = sorted((user_a, user_b))
    return f"dm:{lo}:{hi}"


def ai_room(user_id: str) -> str:
    """The user's private conversation with the Nexus AI assistant."""
    return f"ai:{user_id}"


def _parse_room(room_key: str) -> tuple[str, tuple[str, ...]] | None:
    """('channel', (ws_id, ch_id)) | ('dm', (a, b)) | ('ai', (uid,)) | None."""
    parts = room_key.split(":")
    if len(parts) == 4 and parts[0] == "ws" and parts[2] == "channel":
        return "channel", (parts[1], parts[3])
    if len(parts) == 3 and parts[0] == "dm":
        return "dm", (parts[1], parts[2])
    if len(parts) == 2 and parts[0] == "ai":
        return "ai", (parts[1],)
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
    if kind == "ai":
        # Personal AI room: only its owner, and only on an AI-chat tier. The
        # assistant itself posts via ai_chat_service, never through this guard.
        (owner,) = ids
        if user_id != owner:
            return False
        user = await db.get(User, user_id)
        return user is not None and has_ai_chat(user.subscription_tier)
    # DM: the user must be one of the pair, and the two must co-belong to a workspace.
    a, b = ids
    # Only the canonical dm:{lo}:{hi} form names a room. dm_room() sorts the pair,
    # so an unsorted key is a room no client can build or render — accepting it
    # would give every DM a second, invisible alias addressable only by hand.
    if [a, b] != sorted((a, b)):
        return False
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
        await notify_service.create(
            db, user.id, "Səni qeyd etdilər", f"{author_name}: {content[:200]}",
            NotificationCategory.MENTION,
        )
    await db.flush()


async def post_message(
    db: AsyncSession,
    room_key: str,
    author_id: str,
    author_name: str,
    content: str,
    *,
    meta: dict | None = None,
) -> ChatMessage:
    """Persist a message AS a human member (plain text or a server-built card).

    ``meta.ai`` is exclusive to ai_chat_service (which bypasses this function) —
    rejecting it here makes the "AI cards are unspoofable" invariant mechanical
    instead of a docstring promise."""
    if meta and "ai" in meta:
        raise ValueError("meta.ai yalnız ai_chat_service tərəfindən yazılır")
    if not await can_access_room(db, author_id, room_key):
        raise SchemaNotFoundError("Otağa giriş yoxdur.")
    text = content.strip()[:2000]
    if not text:
        raise ForbiddenError("Mesaj boş ola bilməz.")
    msg = ChatMessage(
        room_key=room_key, author_id=author_id, author_name=author_name[:120] or "İstifadəçi",
        content=text, meta=meta,
    )
    db.add(msg)
    await db.flush()
    await db.refresh(msg)
    await _notify_mentions(db, room_key, text, author_id, msg.author_name)
    return msg


async def message_recipients(
    db: AsyncSession, room_key: str, author_id: str, *, only: set[str] | None = None
) -> list[str]:
    """Members of a room who should be told about a new message from ``author_id``.

    CALL ORDER MATTERS: only for a message that already passed ``post_message``'s
    ``can_access_room`` gate. The DM branch derives the peer from the key with zero
    queries, which is sound only because that gate re-checked ``_co_members`` on the
    very same pair.

    ``only`` narrows to a candidate set (the users with a live mailbox socket), so
    both this query and the fan-out are sized by who is ONLINE rather than by
    workspace membership — an unbounded channel would otherwise let one `viewer`
    turn 2 messages/second into thousands of frames.

    Recipients must keep coming from the same authority as ``can_access_room``
    (workspace membership); sourcing them anywhere else turns a badge into a leak.
    """
    parsed = _parse_room(room_key)
    if parsed is None:
        return []
    kind, ids = parsed
    if kind == "ai":
        return []  # the personal AI room has one member: the owner, who is reading it
    if kind == "dm":
        a, b = ids
        peer = b if a == author_id else a
        if peer == author_id:
            return []
        return [peer] if only is None or peer in only else []
    ws_id, _ = ids
    if only is not None and not only:
        return []
    query = select(WorkspaceMember.user_id).where(
        WorkspaceMember.workspace_id == ws_id, WorkspaceMember.user_id != author_id
    )
    if only is not None:
        query = query.where(WorkspaceMember.user_id.in_(only))
    return list(await db.scalars(query))


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
def _utc(value: datetime) -> datetime:
    """Normalise to aware UTC — SQLite hands back naive datetimes for DateTime(tz=True)."""
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


async def mark_read(
    db: AsyncSession, user_id: str, room_key: str, up_to: datetime | None = None
) -> None:
    """Advance the user's read watermark for a room.

    The watermark is always a real message's ``created_at``, never an app clock.
    That is the whole point: ``created_at`` is ``server_default=func.now()``
    (db/base.py) — the DB clock — so a watermark sampled from ``datetime.now()``
    is not comparable with it. SQLite floors CURRENT_TIMESTAMP to the second and
    Postgres evaluates now() at transaction START, so an app-clock watermark marks
    messages read up to a second BEFORE they exist.

    ``up_to`` is the created_at of the newest message the client actually rendered;
    it is clamped to the newest message that really exists, so a bad or hostile
    value can't silence the room forever. Without it we assume "everything
    currently here". An empty room writes no marker at all — otherwise the next
    message to arrive would be born already-read.

    The watermark only ever moves forward: a late request that sampled an earlier
    time must not resurrect already-read messages.
    """
    if not await can_access_room(db, user_id, room_key):
        raise SchemaNotFoundError("Otağa giriş yoxdur.")
    newest = await db.scalar(
        select(func.max(ChatMessage.created_at)).where(ChatMessage.room_key == room_key)
    )
    if newest is None:
        return  # nothing to mark read yet
    ts = min(_utc(up_to), _utc(newest)) if up_to else _utc(newest)
    marker = (
        await db.execute(
            select(ChatReadMarker).where(
                ChatReadMarker.user_id == user_id, ChatReadMarker.room_key == room_key
            )
        )
    ).scalar_one_or_none()
    if marker is None:
        try:
            # SAVEPOINT: a concurrent first-time mark_read (two tabs entering a room)
            # would otherwise violate uq_read_marker and poison the whole transaction.
            async with db.begin_nested():
                db.add(ChatReadMarker(user_id=user_id, room_key=room_key, last_read_at=ts))
                await db.flush()
            return
        except IntegrityError:
            marker = (
                await db.execute(
                    select(ChatReadMarker).where(
                        ChatReadMarker.user_id == user_id, ChatReadMarker.room_key == room_key
                    )
                )
            ).scalar_one()
    marker.last_read_at = max(_utc(marker.last_read_at), ts)
    await db.flush()


async def _unread_counts(
    db: AsyncSession, user_id: str, room_keys: list[str]
) -> dict[str, tuple[int, datetime]]:
    """Per room with unread: (count, created_at of the newest message counted).

    The timestamp is the snapshot's own cutoff, and it costs one extra column on a
    GROUP BY we already run. A client that receives a live frame and this snapshot
    cannot otherwise tell whether the snapshot already counted that message — the
    two race on first connect — so it would either double-count or drop it.

    TRUSTS ``room_keys`` — it performs no access check, so every caller MUST derive
    them server-side (``my_room_keys``, ``list_channels``, ``dm_peers``).

    Marker-first by design: read the watermarks (index-served by uq_read_marker),
    then ask each room for its tail with a CONSTANT lower bound, which the existing
    ix_chat_messages_room_created serves as a range scan. Outer-joining the markers
    into the message scan instead — as this used to — makes ``created_at >
    last_read_at`` a join-derived predicate the planner cannot push into the scan,
    and ``last_read_at IS NULL`` blocks reducing the LEFT JOIN to an INNER one. The
    result was O(total history in my rooms) rather than O(unread): tens of
    thousands of rows materialised to return a handful of counts.
    """
    if not room_keys:
        return {}
    marked = {
        room: _utc(ts)
        for room, ts in await db.execute(
            select(ChatReadMarker.room_key, ChatReadMarker.last_read_at).where(
                ChatReadMarker.user_id == user_id, ChatReadMarker.room_key.in_(room_keys)
            )
        )
    }
    conds = [
        and_(ChatMessage.room_key == room, ChatMessage.created_at > since)
        for room, since in marked.items()
    ]
    unmarked = [r for r in room_keys if r not in marked]
    if unmarked:
        conds.append(ChatMessage.room_key.in_(unmarked))  # never opened → all unread
    rows = await db.execute(
        select(ChatMessage.room_key, func.count(), func.max(ChatMessage.created_at))
        .where(ChatMessage.author_id != user_id, or_(*conds))
        .group_by(ChatMessage.room_key)
    )
    return {room: (int(count), _utc(newest)) for room, count, newest in rows}


async def my_room_keys(db: AsyncSession, user_id: str) -> list[str]:
    """Every room this user can access: their workspaces' channels + a DM room per
    co-member. Deliberately NOT derived from read markers — a marker can outlive
    access (leaving a workspace), and counting a room the user can no longer open
    would produce a badge they cannot clear. The personal ``ai:{uid}`` room is not
    a team conversation and is absent by construction.
    """
    channels = await db.execute(
        select(Channel.workspace_id, Channel.id)
        .join(WorkspaceMember, WorkspaceMember.workspace_id == Channel.workspace_id)
        .where(WorkspaceMember.user_id == user_id)
    )
    keys = {channel_room(ws_id, ch_id) for ws_id, ch_id in channels}
    my_ws = select(WorkspaceMember.workspace_id).where(WorkspaceMember.user_id == user_id)
    # Ids only — dm_peers() hydrates whole User entities, which is a 500-row ORM
    # load just to build strings and throw the users away.
    peers = await db.scalars(
        select(WorkspaceMember.user_id)
        .where(WorkspaceMember.workspace_id.in_(my_ws), WorkspaceMember.user_id != user_id)
        .distinct()
    )
    keys.update(dm_room(user_id, peer) for peer in peers)
    return list(keys)


async def unread_overview(db: AsyncSession, user_id: str) -> dict[str, dict]:
    """{room_key: {"unread": n, "at": iso}} for every accessible room with unread.

    Rooms with nothing unread are absent, so the payload tracks real conversations
    rather than org size. ``at`` is the cutoff this snapshot saw — the mailbox
    socket sends it so a client can tell a live frame that is already counted here
    from one that arrived after the query ran.
    """
    counts = await _unread_counts(db, user_id, await my_room_keys(db, user_id))
    return {
        room: {"unread": count, "at": newest.isoformat()}
        for room, (count, newest) in counts.items()
    }


async def room_summaries(
    db: AsyncSession, user_id: str, room_keys: list[str]
) -> dict[str, tuple[ChatMessage | None, int]]:
    """Per-room (last message, unread count) for a conversation list.

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

    for room, (count, _newest) in (await _unread_counts(db, user_id, room_keys)).items():
        last, _ = out.get(room, (None, 0))
        out[room] = (last, count)
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
