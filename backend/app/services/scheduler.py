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
from app.services import saved_query_service
from app.services.cache_service import CacheService

log = get_logger("nexusbi.scheduler")


async def _tick(cache: CacheService) -> None:
    async with AsyncSessionLocal() as db:
        try:
            ran = await saved_query_service.run_due(db, cache)
            await db.commit()
            if ran:
                log.info("scheduler_ran", count=ran)
        except Exception as exc:  # noqa: BLE001 — never let one tick kill the loop
            await db.rollback()
            log.error("scheduler_tick_failed", error=str(exc))


async def run_loop(cache: CacheService) -> None:
    log.info("scheduler_started", interval=settings.SCHEDULER_INTERVAL_SECONDS)
    while True:
        await asyncio.sleep(settings.SCHEDULER_INTERVAL_SECONDS)
        await _tick(cache)
