"""Shared LRU cache of AsyncEngines for user datasources.

Reusing one engine per connection string lets SQLAlchemy's built-in connection
pool work (no per-query handshake, no connection exhaustion). Bounded + disposed
on shutdown / datasource deletion.
"""
from __future__ import annotations

import asyncio
from collections import OrderedDict

from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from app.config import settings

MAX_ENGINES = settings.DATASOURCE_MAX_ENGINES

_engines: "OrderedDict[str, AsyncEngine]" = OrderedDict()
_lock = asyncio.Lock()


def _make_engine(conn_str: str) -> AsyncEngine:
    # SQLite uses non-queue pools — pass only universally-safe options.
    if conn_str.startswith("sqlite"):
        return create_async_engine(conn_str, pool_pre_ping=True)
    return create_async_engine(
        conn_str,
        pool_size=settings.DATASOURCE_POOL_SIZE,
        max_overflow=settings.DATASOURCE_POOL_MAX_OVERFLOW,
        pool_pre_ping=True,
        pool_recycle=settings.DATASOURCE_POOL_RECYCLE_SECONDS,
    )


async def get_engine(conn_str: str) -> AsyncEngine:
    """Return a pooled engine for the connection string, creating it if needed."""
    async with _lock:
        engine = _engines.get(conn_str)
        if engine is not None:
            _engines.move_to_end(conn_str)
            return engine
        engine = _make_engine(conn_str)
        _engines[conn_str] = engine
        while len(_engines) > MAX_ENGINES:
            _, evicted = _engines.popitem(last=False)
            await evicted.dispose()
        return engine


async def evict(conn_str: str) -> None:
    """Drop and dispose the engine for a connection string, if cached."""
    async with _lock:
        engine = _engines.pop(conn_str, None)
    if engine is not None:
        await engine.dispose()


async def dispose_all() -> None:
    """Dispose every cached engine (shutdown)."""
    async with _lock:
        engines = list(_engines.values())
        _engines.clear()
    for engine in engines:
        await engine.dispose()
