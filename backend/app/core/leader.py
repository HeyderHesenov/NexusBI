"""Single-runner election for the background loops.

Every uvicorn worker runs the full app, so every worker also started its own
scheduler and live-refresh loop. With four workers a scheduled report went out
four times, a decision was measured four times, and the daily AI brief cost four
times its tokens — the duplication scaled with the deployment, which is the worst
direction for it to scale.

The lock is a Redis key holding the leader's node id, taken with SET NX PX. Only
the holder acts; everyone else skips the tick and tries again next time. Two
properties matter more than they look:

- **Sticky.** Re-acquiring your own lock extends it rather than failing, so the
  same worker keeps the job instead of leadership ping-ponging every tick.
- **Renewed during the tick.** ``run_digests_due`` walks every active user with
  up to five LLM calls each, so a tick can easily outlive a lease. Without
  renewal the lease expires mid-tick and a second worker starts the same work —
  the exact duplicate this module exists to prevent.

Without Redis there is no way to coordinate, and the honest response is to stand
down loudly rather than let each worker run the job. Losing a scheduled report is
recoverable; sending it to every customer once per worker is not. An operator who
genuinely runs a single process sets ``SCHEDULER_REQUIRE_LOCK=false``.
"""
from __future__ import annotations

import asyncio
import os
import uuid
from contextlib import asynccontextmanager
from typing import Any

from app.config import settings
from app.core.logging import get_logger

log = get_logger("nexusbi.leader")

# Comfortably longer than a scheduler tick (60s), so the holder keeps the job
# between ticks instead of re-electing every time. Failover after a worker dies
# is bounded by this.
DEFAULT_TTL_MS = 180_000
_RENEW_DIVISOR = 3  # renew at a third of the lease, so two renewals may be lost

# Stable within a process, distinct across workers — os.getpid() alone repeats
# across containers.
NODE_ID = f"{os.getpid()}-{uuid.uuid4().hex[:8]}"

_no_redis_warned = False


def _key(job: str) -> str:
    return f"nexusbi:leader:{job}"


async def acquire(cache: Any, job: str, node_id: str, ttl_ms: int = DEFAULT_TTL_MS) -> bool:
    """True if ``node_id`` holds the lock for ``job`` after this call.

    Acquires when free and extends when already ours; both are the same question
    from the caller's side ("may I run?"), and answering them in one atomic step
    avoids a gap where a competitor could slip in between check and extend.
    """
    if cache is None or not getattr(cache, "available", False):
        return False
    held = await cache.acquire_or_extend(_key(job), node_id, ttl_ms)
    return bool(held)


async def release(cache: Any, job: str, node_id: str) -> None:
    """Drop the lock, but only if it is still ours.

    A worker whose lease expired mid-tick would otherwise delete the lock its
    successor now holds, handing a third worker a lock nobody is coordinating on.
    """
    if cache is None or not getattr(cache, "available", False):
        return
    await cache.release_if_owner(_key(job), node_id)


async def _renew_forever(cache: Any, job: str, node_id: str, ttl_ms: int) -> None:
    interval = ttl_ms / _RENEW_DIVISOR / 1000
    while True:
        await asyncio.sleep(interval)
        if not await acquire(cache, job, node_id, ttl_ms):
            # Lost it — the tick body keeps running to completion, but the next
            # tick will see the loss and stand down.
            log.warning("leader_lease_lost", job=job, node=node_id)
            return


@asynccontextmanager
async def elected(
    cache: Any, job: str, node_id: str = NODE_ID, ttl_ms: int = DEFAULT_TTL_MS
):
    """Yield True if this worker may run ``job`` now, renewing while the body runs.

    Deliberately does NOT release on exit: keeping the lease is what makes
    leadership sticky across ticks. A dead leader's lease expires on its own.
    """
    global _no_redis_warned

    if cache is None or not getattr(cache, "available", False):
        if settings.SCHEDULER_REQUIRE_LOCK:
            if not _no_redis_warned:
                _no_redis_warned = True
                log.error(
                    "leader_no_redis_standing_down",
                    job=job,
                    msg=(
                        "Redis əlçatan deyil — planlaşdırılmış işlər DAYANDIRILDI. "
                        "Çox worker-də koordinasiya olmadan hesabat hər worker üçün "
                        "bir dəfə göndərilərdi. Tək prosesdə işləyirsinizsə "
                        "SCHEDULER_REQUIRE_LOCK=false qoyun."
                    ),
                )
            yield False
            return
        yield True  # operator asserts a single process
        return

    if not await acquire(cache, job, node_id, ttl_ms):
        yield False
        return

    renew = asyncio.create_task(_renew_forever(cache, job, node_id, ttl_ms))
    try:
        yield True
    finally:
        renew.cancel()
        try:
            await renew
        except asyncio.CancelledError:
            pass
