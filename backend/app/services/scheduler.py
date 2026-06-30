"""Lightweight in-process scheduler for saved-query refreshes.

A single asyncio loop wakes every SCHEDULER_INTERVAL_SECONDS and runs any
scheduled saved query that is due. No external dependency; runs only while the
server is up (fine for this app's scope).
"""
from __future__ import annotations

import asyncio

from app.config import settings
from app.core.logging import get_logger
from app.db.session import AsyncSessionLocal
from app.services import decision_service, digest_service, saved_query_service
from app.services.cache_service import CacheService

log = get_logger("nexusbi.scheduler")


_MAX_BACKOFF_SECONDS = 600  # cap exponential backoff at 10 minutes


async def _tick(cache: CacheService) -> bool:
    """Run due saved queries. Returns True on success, False on failure."""
    async with AsyncSessionLocal() as db:
        try:
            ran = await saved_query_service.run_due(db, cache)
            await db.commit()
            if ran:
                log.info("scheduler_ran", count=ran)
        except Exception as exc:  # noqa: BLE001 — never let one tick kill the loop
            await db.rollback()
            log.error("scheduler_tick_failed", error=str(exc))
            return False
        # Decision Intelligence Loop: re-measure due decisions in their OWN
        # transaction so a measurement failure can't roll back the saved-query work.
        try:
            measured = await decision_service.run_measurements_due(db, cache)
            await db.commit()
            if measured:
                log.info("scheduler_measured_decisions", count=measured)
        except Exception as exc:  # noqa: BLE001
            await db.rollback()
            log.error("scheduler_decision_measure_failed", error=str(exc))
            return False
        # Proactive AI brief runs in its OWN transaction so a digest failure can't
        # roll back the saved-query work already committed above.
        try:
            await digest_service.run_digests_due(db)
            await db.commit()
        except Exception as exc:  # noqa: BLE001
            await db.rollback()
            log.error("scheduler_digest_failed", error=str(exc))
            return False
        return True


async def run_loop(cache: CacheService) -> None:
    log.info("scheduler_started", interval=settings.SCHEDULER_INTERVAL_SECONDS)
    interval = settings.SCHEDULER_INTERVAL_SECONDS
    consecutive_failures = 0
    while True:
        # Exponential backoff on repeated failures (e.g. DB down) so a broken
        # tick doesn't spam logs or hammer a failing dependency every interval.
        if consecutive_failures:
            delay = min(interval * (2**consecutive_failures), _MAX_BACKOFF_SECONDS)
        else:
            delay = interval
        await asyncio.sleep(delay)
        ok = await _tick(cache)
        consecutive_failures = 0 if ok else consecutive_failures + 1
