"""Datasource engine pool — caching, LRU eviction, dispose."""
from __future__ import annotations

import pytest

from app.db import engine_pool


@pytest.fixture(autouse=True)
async def _clean_pool():
    await engine_pool.dispose_all()
    yield
    await engine_pool.dispose_all()


async def test_get_engine_caches_per_conn_str(tmp_path):
    a = f"sqlite+aiosqlite:///{tmp_path / 'a.db'}"
    b = f"sqlite+aiosqlite:///{tmp_path / 'b.db'}"

    e1 = await engine_pool.get_engine(a)
    e2 = await engine_pool.get_engine(a)
    e3 = await engine_pool.get_engine(b)

    assert e1 is e2          # same conn → same engine (pool reused)
    assert e1 is not e3      # different conn → different engine


async def test_lru_eviction(tmp_path, monkeypatch):
    monkeypatch.setattr(engine_pool, "MAX_ENGINES", 1)
    a = f"sqlite+aiosqlite:///{tmp_path / 'a.db'}"
    b = f"sqlite+aiosqlite:///{tmp_path / 'b.db'}"

    e_a = await engine_pool.get_engine(a)
    await engine_pool.get_engine(b)  # exceeds cap of 1 → evicts a

    e_a2 = await engine_pool.get_engine(a)
    assert e_a2 is not e_a  # a was evicted, so a fresh engine is created


async def test_evict_and_dispose_all(tmp_path):
    a = f"sqlite+aiosqlite:///{tmp_path / 'a.db'}"
    e1 = await engine_pool.get_engine(a)
    await engine_pool.evict(a)
    e2 = await engine_pool.get_engine(a)
    assert e2 is not e1  # evicted → recreated
