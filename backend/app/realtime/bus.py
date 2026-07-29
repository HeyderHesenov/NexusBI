"""Cross-worker bus for the connection hub.

Rooms live in each worker's own memory, which is correct for delivery (a socket
can only be written by the process holding it) and wrong for anything that has to
be true everywhere. Eviction is the case that matters: `room_ws` authorises once
at connect and never re-checks, so a member removed from a workspace keeps
receiving full message bodies on every worker that did not handle the DELETE.
Membership is a security boundary, so the hang-up has to reach all of them.

Deliberately narrow for now. Only eviction crosses; ordinary broadcasts still fan
out locally, because making chat and presence cross workers changes delivery
semantics and can invent ghost participants — a visible regression in a feature
people use, in exchange for a correctness win they will not see. The security
half ships first and on its own.

Without Redis this is inert and the hub behaves exactly as it did: correct for a
single process, which is the only deployment that had no bus to begin with.
"""
from __future__ import annotations

import asyncio
import json
import time
from dataclasses import asdict
from typing import Any

from app.core.logging import get_logger

log = get_logger("nexusbi.realtime")

EVICT_CHANNEL = "nexusbi:hub:evict"
ROOM_CHANNEL = "nexusbi:hub:room"
_PRESENCE_ROOM = "nexusbi:presence:room:{room}"
_PRESENCE_USERS = "nexusbi:presence:users"
_USER_PREFIX = "user:"


# ─── Room delivery ───
#
# One channel for every room rather than `nexusbi:room:<id>` per room. Per-room
# channels would mean subscribing and unsubscribing as rooms come and go, and
# every worker still receives every message it is subscribed to, so the saving is
# a filter this app is nowhere near needing. Splitting is the scaling step, not
# the correctness step.


async def publish_room(
    cache: Any, room: str, message: dict[str, Any], exclude_conn_id: str | None
) -> bool:
    """Hand a room message to every worker, including this one."""
    if cache is None or not getattr(cache, "available", False):
        return False
    return await cache.publish(
        ROOM_CHANNEL, {"room": room, "message": message, "exclude": exclude_conn_id}
    )


async def run_room_subscriber(
    hub: Any, cache: Any, ready: asyncio.Event | None = None
) -> None:
    """Deliver published room messages to this worker's sockets.

    Every delivery goes through here, including for the worker that published.
    Sending locally *and* publishing would deliver twice to anyone connected to
    the sender's process, which is the version of this that looks like it works.
    """
    if cache is None or not getattr(cache, "available", False):
        if ready is not None:
            ready.set()
        return
    async for payload in cache.subscribe(ROOM_CHANNEL, ready=ready):
        try:
            await hub.deliver_local(
                payload["room"], payload["message"], exclude_conn_id=payload.get("exclude")
            )
        except Exception as exc:  # noqa: BLE001 — one bad message must not end the loop
            log.warning("hub_room_delivery_failed", error=str(exc)[:200])


# ─── Presence ───
#
# A sorted set per room, scored by the last heartbeat. Presence stops being "a
# socket I can see" and becomes "a record someone wrote", and records outlive the
# thing they describe — a worker that is SIGKILLed runs no cleanup. Scoring by
# time means a stale entry is arithmetic rather than bookkeeping: anything older
# than the TTL simply is not in the answer, and gets trimmed on the way past.


async def register_presence(cache: Any, room: str, participant: Any) -> None:
    """Record (or refresh) a participant in a room."""
    if cache is None or not getattr(cache, "available", False):
        return
    member = json.dumps(asdict(participant), sort_keys=True)
    now = time.time()
    await cache.zadd(_PRESENCE_ROOM.format(room=room), member, now)
    if room.startswith(_USER_PREFIX) and participant.user_id:
        # Mailbox rooms double as the online-users index that unread fan-out reads.
        await cache.zadd(_PRESENCE_USERS, participant.user_id, now)


async def forget_presence(cache: Any, room: str, participant: Any) -> None:
    """Drop a participant on a clean disconnect, rather than waiting out the TTL."""
    if cache is None or not getattr(cache, "available", False):
        return
    member = json.dumps(asdict(participant), sort_keys=True)
    await cache.zrem(_PRESENCE_ROOM.format(room=room), member)
    if room.startswith(_USER_PREFIX) and participant.user_id:
        await cache.zrem(_PRESENCE_USERS, participant.user_id)


async def read_presence(cache: Any, room: str, ttl_seconds: int) -> list[dict[str, Any]]:
    """The room's live participants, stale entries trimmed on the way."""
    if cache is None or not getattr(cache, "available", False):
        return []
    raw = await cache.zrange_fresh(_PRESENCE_ROOM.format(room=room), time.time() - ttl_seconds)
    out: list[dict[str, Any]] = []
    for member in raw:
        try:
            out.append(json.loads(member))
        except (ValueError, TypeError):
            continue
    return out


async def read_online_users(cache: Any, ttl_seconds: int) -> set[str]:
    if cache is None or not getattr(cache, "available", False):
        return set()
    return set(await cache.zrange_fresh(_PRESENCE_USERS, time.time() - ttl_seconds))


async def run_presence_heartbeat(hub: Any, interval_seconds: int) -> None:
    """Keep this worker's presence records alive for as long as it is alive."""
    while True:
        await asyncio.sleep(interval_seconds)
        try:
            await hub.heartbeat_once()
        except Exception as exc:  # noqa: BLE001 — a missed beat is recoverable
            log.warning("presence_heartbeat_failed", error=str(exc)[:200])


async def publish_evict(
    cache: Any, room_prefix: str, user_ids: set[str] | None
) -> bool:
    """Tell every other worker to hang up matching sockets."""
    if cache is None or not getattr(cache, "available", False):
        return False
    return await cache.publish(
        EVICT_CHANNEL,
        {"room_prefix": room_prefix, "user_ids": sorted(user_ids) if user_ids else None},
    )


async def run_evict_subscriber(
    hub: Any, cache: Any, ready: asyncio.Event | None = None
) -> None:
    """Apply eviction commands published by other workers. Runs for the app's life.

    The publisher receives its own message too and re-runs the eviction locally;
    that is a no-op, since the sockets are already closed and removed. Paying for
    an idempotent second pass is cheaper than tracking sender identity.
    """
    if cache is None or not getattr(cache, "available", False):
        if ready is not None:
            ready.set()
        return
    async for message in cache.subscribe(EVICT_CHANNEL, ready=ready):
        try:
            prefix = message["room_prefix"]
            raw_ids = message.get("user_ids")
            closed = await hub.evict_local(prefix, set(raw_ids) if raw_ids else None)
            if closed:
                log.info("hub_evict_applied", prefix=prefix, closed=closed)
        except Exception as exc:  # noqa: BLE001 — one bad message must not end the loop
            log.warning("hub_evict_failed", error=str(exc)[:200])
