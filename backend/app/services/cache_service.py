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
