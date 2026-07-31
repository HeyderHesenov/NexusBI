"""Monthly AI quota: atomicity, the rolling window, and proportional charging."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.billing import tiers, usage_service
from app.core.exceptions import RateLimitError
from app.db.session import AsyncSessionLocal
from app.models.user import User


async def _make_user(tier: str = "free", used: int = 0) -> str:
    # uuid, not a name built from the arguments: several tests create users with
    # the same tier and count, and email is unique.
    async with AsyncSessionLocal() as s:
        u = User(
            email=f"q-{uuid.uuid4()}@x.io",
            hashed_password="x",
            full_name="Q",
            subscription_tier=tier,
            ai_calls_used=used,
            usage_period_start=datetime.now(timezone.utc),
        )
        s.add(u)
        await s.commit()
        return u.id


async def _used(user_id: str) -> int:
    async with AsyncSessionLocal() as s:
        return (await s.execute(select(User.ai_calls_used).where(User.id == user_id))).scalar_one()


async def test_an_increment_is_not_lost_to_a_stale_read() -> None:
    """Two requests that both read before either writes.

    Sequenced by hand rather than with asyncio.gather: SQLite serialises writers,
    so a gather would just queue them and prove nothing — and two uncommitted
    writes to one row would deadlock. What actually causes the bug is the *read*
    being stale, so both reads happen first, then the writes go one at a time.
    Read-modify-write computes 0+1 twice and lands on 1; `ai_calls_used + 1`
    evaluated in SQL lands on 2.
    """
    user_id = await _make_user()
    async with AsyncSessionLocal() as s1, AsyncSessionLocal() as s2:
        u1 = (await s1.execute(select(User).where(User.id == user_id))).scalar_one()
        u2 = (await s2.execute(select(User).where(User.id == user_id))).scalar_one()
        assert u1.ai_calls_used == u2.ai_calls_used == 0

        await usage_service.check_and_consume(s1, u1)
        await s1.commit()
        await usage_service.check_and_consume(s2, u2)  # u2 still holds the stale 0
        await s2.commit()

    assert await _used(user_id) == 2


async def test_quota_exhaustion_raises_and_does_not_increment() -> None:
    # Read the limit from the catalogue rather than hardcoding it: Task 10
    # renumbers every tier, and a literal here would silently rot.
    full = tiers.get_tier("free").monthly_quota
    user_id = await _make_user(used=full)
    async with AsyncSessionLocal() as s:
        user = (await s.execute(select(User).where(User.id == user_id))).scalar_one()
        with pytest.raises(RateLimitError):
            await usage_service.check_and_consume(s, user)
        await s.commit()
    assert await _used(user_id) == full


async def test_an_elapsed_window_resets_the_counter_in_the_same_statement() -> None:
    user_id = await _make_user(used=tiers.get_tier("free").monthly_quota)
    async with AsyncSessionLocal() as s:
        user = (await s.execute(select(User).where(User.id == user_id))).scalar_one()
        user.usage_period_start = datetime.now(timezone.utc) - timedelta(days=31)
        await s.commit()
        await usage_service.check_and_consume(s, user)
        await s.commit()
    assert await _used(user_id) == 1


async def test_extra_units_are_charged_unconditionally() -> None:
    """The calls already happened; the charge cannot be refused."""
    user_id = await _make_user(used=29)
    await usage_service.consume_extra(user_id, 18)
    assert await _used(user_id) == 47
