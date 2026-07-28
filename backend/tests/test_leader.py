"""Single-runner election for the background loops.

Every worker starts its own scheduler and live-refresh loop, so with N workers a
scheduled report was delivered N times, a decision was measured N times, and the
daily AI brief cost N times its tokens. The election makes exactly one of them
act per tick.
"""
from __future__ import annotations

import asyncio

import pytest

from app.core import leader


async def _cache():
    from app.services.cache_service import build_cache_service

    cache = await build_cache_service()
    if not cache.available:
        pytest.skip("Redis unavailable — the no-Redis policy is covered separately")
    return cache


async def test_only_one_worker_wins(unique_job):
    """The whole point: two workers, one runner."""
    worker_a, worker_b = await _cache(), await _cache()
    try:
        assert await leader.acquire(worker_a, unique_job, "node-a") is True
        assert await leader.acquire(worker_b, unique_job, "node-b") is False
    finally:
        await leader.release(worker_a, unique_job, "node-a")
        await worker_a.aclose()
        await worker_b.aclose()


async def test_the_holder_keeps_it_across_ticks(unique_job):
    """Re-acquiring your own lock extends it — leadership is sticky, not a
    fresh election every tick that ping-pongs work between workers."""
    cache = await _cache()
    try:
        assert await leader.acquire(cache, unique_job, "node-a") is True
        assert await leader.acquire(cache, unique_job, "node-a") is True
        assert await leader.acquire(cache, unique_job, "node-b") is False
    finally:
        await leader.release(cache, unique_job, "node-a")
        await cache.aclose()


async def test_a_dead_leader_hands_over_after_the_ttl(unique_job):
    """Failover: a worker that dies holding the lock must not block the job forever."""
    cache = await _cache()
    try:
        assert await leader.acquire(cache, unique_job, "node-a", ttl_ms=300) is True
        assert await leader.acquire(cache, unique_job, "node-b", ttl_ms=300) is False
        await asyncio.sleep(0.5)  # node-a "dies"; the key expires on its own
        assert await leader.acquire(cache, unique_job, "node-b", ttl_ms=300) is True
    finally:
        await leader.release(cache, unique_job, "node-b")
        await cache.aclose()


async def test_release_only_drops_your_own_lock(unique_job):
    """A slow worker whose lock expired must not delete its successor's."""
    cache = await _cache()
    try:
        assert await leader.acquire(cache, unique_job, "node-b") is True
        await leader.release(cache, unique_job, "node-a")  # stale owner tries to clean up
        assert await leader.acquire(cache, unique_job, "node-c") is False  # b still holds it
    finally:
        await leader.release(cache, unique_job, "node-b")
        await cache.aclose()


async def test_elected_renews_while_a_long_tick_runs(unique_job):
    """A tick longer than the TTL must not let a second worker start the same tick.

    run_digests_due walks every active user with up to five LLM calls each, so
    "the tick outlives the lease" is a real shape, not a hypothetical.
    """
    cache, other = await _cache(), await _cache()
    try:
        async with leader.elected(cache, unique_job, "node-a", ttl_ms=300) as is_leader:
            assert is_leader
            await asyncio.sleep(0.9)  # three TTLs; the renew task must cover it
            assert await leader.acquire(other, unique_job, "node-b", ttl_ms=300) is False
    finally:
        await leader.release(cache, unique_job, "node-a")
        await cache.aclose()
        await other.aclose()


# ─── No Redis: never silently duplicate ───


class _NoRedis:
    available = False

    async def acquire_or_extend(self, key, token, ttl_ms):
        return None


async def test_without_redis_the_loop_stands_down_by_default(unique_job, monkeypatch):
    """Unable to coordinate means unable to promise single delivery.

    Standing down is loud and loses the job; running anyway sends the report once
    per worker. Losing it is the recoverable failure.
    """
    from app.config import settings

    monkeypatch.setattr(settings, "SCHEDULER_REQUIRE_LOCK", True)
    async with leader.elected(_NoRedis(), unique_job, "node-a") as is_leader:
        assert is_leader is False


async def test_without_redis_an_operator_can_declare_a_single_worker(unique_job, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "SCHEDULER_REQUIRE_LOCK", False)
    async with leader.elected(_NoRedis(), unique_job, "node-a") as is_leader:
        assert is_leader is True


# ─── The loop actually honours it ───


async def _run_scheduler_briefly(monkeypatch, cache, ticks: list[int]) -> None:
    """Drive scheduler.run_loop for a couple of turns, then stop it."""
    from app.config import settings
    from app.services import scheduler

    monkeypatch.setattr(settings, "SCHEDULER_INTERVAL_SECONDS", 0)

    async def counting_tick(_cache):
        ticks.append(1)
        return True

    monkeypatch.setattr(scheduler, "_tick", counting_tick)
    task = asyncio.create_task(scheduler.run_loop(cache))
    await asyncio.sleep(0.05)
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


async def test_the_scheduler_loop_runs_only_when_it_holds_the_lease(monkeypatch):
    cache = await _cache()
    other = await _cache()
    job = "scheduler"
    try:
        # Someone else is already the leader, so this worker must do nothing.
        assert await leader.acquire(other, job, "another-worker", ttl_ms=5000) is True
        ticks: list[int] = []
        await _run_scheduler_briefly(monkeypatch, cache, ticks)
        assert ticks == [], "a follower must not run scheduled work"

        # Hand the lease over; now it should work.
        await leader.release(other, job, "another-worker")
        await _run_scheduler_briefly(monkeypatch, cache, ticks)
        assert ticks, "the leader must run scheduled work"
    finally:
        await leader.release(cache, job, leader.NODE_ID)
        await cache.aclose()
        await other.aclose()


@pytest.fixture
def unique_job() -> str:
    import uuid

    return f"test_job_{uuid.uuid4().hex}"
