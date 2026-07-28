"""Redis cache wrapper. Degrades gracefully when Redis is unavailable."""
from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from typing import Any

import redis.asyncio as aioredis

from app.config import settings


class CacheService:
    """Thin async Redis wrapper with JSON (de)serialization."""

    def __init__(self, client: aioredis.Redis | None) -> None:
        self._client = client

    @property
    def available(self) -> bool:
        return self._client is not None

    async def get(self, key: str) -> Any | None:
        if not self._client:
            return None
        try:
            raw = await self._client.get(key)
            return json.loads(raw) if raw else None
        except Exception:
            return None

    async def set(self, key: str, value: Any, ttl: int = 3600) -> None:
        if not self._client:
            return
        try:
            await self._client.set(key, json.dumps(value, default=str), ex=ttl)
        except Exception:
            pass

    async def delete(self, key: str) -> None:
        if not self._client:
            return
        try:
            await self._client.delete(key)
        except Exception:
            pass

    async def delete_prefix(self, prefix: str) -> None:
        """Delete every key starting with ``prefix`` (SCAN-based, non-blocking).

        Used to invalidate cached results when access rules change (e.g. an RLS
        rule is added — stale, less-restricted rows must not survive to TTL).
        """
        if not self._client:
            return
        try:
            async for key in self._client.scan_iter(match=f"{prefix}*", count=200):
                await self._client.delete(key)
        except Exception:
            pass

    # INCR then EXPIRE only on creation, as one atomic step. A pipeline would not
    # do: if the process died between the two commands the key would never expire
    # and the caller would be locked out permanently.
    _INCR_WITH_TTL = """
        local n = redis.call('INCR', KEYS[1])
        if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
        return n
    """

    async def incr(self, key: str, ttl: int) -> int | None:
        """Increment `key`, setting `ttl` when it is created. New count, or None.

        None means "Redis did not answer" — distinct from a real count, so a
        caller can fall back instead of reading a failure as zero.
        """
        if not self._client:
            return None
        try:
            return int(await self._client.eval(self._INCR_WITH_TTL, 1, key, ttl))
        except Exception:
            return None

    # Acquire-or-extend in one atomic step. Splitting it into GET then SET leaves a
    # gap where a competitor can take the key between the two, which is exactly the
    # window a leader lock must not have.
    _ACQUIRE_OR_EXTEND = """
        local cur = redis.call('GET', KEYS[1])
        if cur == false then
            redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
            return 1
        elseif cur == ARGV[1] then
            redis.call('PEXPIRE', KEYS[1], ARGV[2])
            return 1
        end
        return 0
    """

    # Compare-and-delete: a worker whose lease already expired must not delete the
    # lock its successor now holds.
    _RELEASE_IF_OWNER = """
        if redis.call('GET', KEYS[1]) == ARGV[1] then
            return redis.call('DEL', KEYS[1])
        end
        return 0
    """

    async def acquire_or_extend(self, key: str, token: str, ttl_ms: int) -> bool | None:
        """True if `token` owns `key` after this call. None if Redis did not answer."""
        if not self._client:
            return None
        try:
            return bool(await self._client.eval(self._ACQUIRE_OR_EXTEND, 1, key, token, ttl_ms))
        except Exception:
            return None

    async def release_if_owner(self, key: str, token: str) -> bool:
        """Delete `key` only when `token` still owns it."""
        if not self._client:
            return False
        try:
            return bool(await self._client.eval(self._RELEASE_IF_OWNER, 1, key, token))
        except Exception:
            return False

    async def publish(self, channel: str, payload: Any) -> bool:
        """Fan a JSON payload out to every subscriber. False if Redis is absent."""
        if not self._client:
            return False
        try:
            await self._client.publish(channel, json.dumps(payload, default=str))
            return True
        except Exception:
            return False

    async def subscribe(
        self, channel: str, ready: asyncio.Event | None = None
    ) -> AsyncIterator[Any]:
        """Yield decoded payloads published to `channel` until cancelled.

        `ready` is set once the subscription is live. Redis pub/sub drops anything
        published before a subscriber attaches, so a caller that publishes and then
        expects delivery has to wait for it — otherwise the test (or the startup
        race) silently loses the first message.
        """
        if not self._client:
            if ready is not None:
                ready.set()
            return
        pubsub = self._client.pubsub()
        try:
            await pubsub.subscribe(channel)
            if ready is not None:
                ready.set()
            async for raw in pubsub.listen():
                if raw.get("type") != "message":
                    continue  # subscribe/unsubscribe confirmations
                try:
                    yield json.loads(raw["data"])
                except (ValueError, TypeError):
                    continue  # a malformed publish must not end the subscription
        finally:
            try:
                await pubsub.aclose()
            except Exception:
                pass

    async def ping(self) -> bool:
        """True if Redis answers. Used by the readiness probe, never on a hot path."""
        if not self._client:
            return False
        try:
            return bool(await self._client.ping())
        except Exception:
            return False

    async def aclose(self) -> None:
        """Close the underlying Redis connection (for transient/per-tick clients)."""
        if self._client:
            try:
                await self._client.aclose()
            except Exception:
                pass


async def build_cache_service() -> CacheService:
    """Connect to Redis; return a no-op cache if unreachable."""
    try:
        client: aioredis.Redis = aioredis.from_url(
            settings.REDIS_URL, decode_responses=True
        )
        await client.ping()
        return CacheService(client)
    except Exception:
        return CacheService(None)
