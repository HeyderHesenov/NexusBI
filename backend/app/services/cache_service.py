"""Redis cache wrapper. Degrades gracefully when Redis is unavailable."""
from __future__ import annotations

import json
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
