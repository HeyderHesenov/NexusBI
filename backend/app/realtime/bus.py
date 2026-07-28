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
from typing import Any

from app.core.logging import get_logger

log = get_logger("nexusbi.realtime")

EVICT_CHANNEL = "nexusbi:hub:evict"


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
