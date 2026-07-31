"""Monthly AI quota: atomicity, the rolling window, and proportional charging."""
from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.ai import call_context
from app.billing import tiers, usage_service
from app.core.exceptions import RateLimitError
from app.db.session import AsyncSessionLocal
from app.models.ai_spend import AISpendDaily
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


# ─── The per-request completion counter ───


def test_the_counter_is_per_request_and_restores_cleanly() -> None:
    token = call_context.begin()
    call_context.bump()
    call_context.bump()
    assert call_context.count() == 2
    call_context.end(token)
    assert call_context.count() == 0


def test_a_bump_outside_any_request_is_a_no_op() -> None:
    """Scheduler digests and alert evaluations call the model with no request
    around them. They must not raise, and must not leak into whatever request
    the same worker serves next."""
    call_context.bump()
    assert call_context.count() == 0


async def test_completions_made_inside_gather_are_still_counted() -> None:
    """asyncio.gather wraps each coroutine in a Task, and a Task *copies* the
    context — so a ContextVar holding a plain int would take every bump into a
    copy the parent never sees. This is not hypothetical: query_service runs
    chart selection and insight generation exactly this way, so two of a simple
    question's three completions would go uncharged, and dashboard_service fans
    out per question, losing nearly all nineteen.
    """
    token = call_context.begin()

    async def one() -> None:
        call_context.bump()

    await asyncio.gather(one(), one(), one())
    assert call_context.count() == 3
    call_context.end(token)


async def test_a_fan_out_request_is_charged_for_every_completion() -> None:
    """One HTTP request, nineteen completions, nineteen units.

    The dependency is driven the way FastAPI drives it — enter, run the endpoint
    body, exit — because the reconciliation only happens on the way out.
    """
    from app.dependencies import enforce_rate_limit

    user_id = await _make_user(tier="pro")
    async with AsyncSessionLocal() as s:
        user = (await s.execute(select(User).where(User.id == user_id))).scalar_one()
        agen = enforce_rate_limit(user=user, db=s)
        await agen.__anext__()          # dependency setup: takes the first unit
        for _ in range(19):             # stands in for the endpoint's model calls
            call_context.bump()
        with pytest.raises(StopAsyncIteration):
            await agen.__anext__()      # teardown: charges the other eighteen
        await s.commit()

    assert await _used(user_id) == 19


async def test_a_raised_endpoint_still_reconciles_on_the_way_out() -> None:
    """A request that dies halfway already spent whatever it spent, so the
    teardown runs and charges on the exception path too."""
    from app.dependencies import enforce_rate_limit

    user_id = await _make_user(tier="pro")
    async with AsyncSessionLocal() as s:
        user = (await s.execute(select(User).where(User.id == user_id))).scalar_one()
        agen = enforce_rate_limit(user=user, db=s)
        await agen.__anext__()
        for _ in range(4):
            call_context.bump()
        with pytest.raises(RuntimeError):
            await agen.athrow(RuntimeError("endpoint blew up"))
        await s.commit()

    assert await _used(user_id) == 4


async def test_a_rolled_back_request_is_charged_nothing() -> None:
    """The stated price of reconciling inside the request's transaction.

    The charge cannot use a second connection — the request's own +1 holds this
    row, and waiting on it from outside deadlocks. So the charge shares the
    request's fate: a rollback takes the extra units *and* the up-front unit
    with it. The money is not refunded with them; ai_spend_daily is written from
    its own session, which `test_ai_cost.test_spend_survives_a_rolled_back_request`
    pins, so the daily ceiling still sees every call that was made.
    """
    from app.dependencies import enforce_rate_limit

    user_id = await _make_user(tier="pro")
    async with AsyncSessionLocal() as s:
        user = (await s.execute(select(User).where(User.id == user_id))).scalar_one()
        agen = enforce_rate_limit(user=user, db=s)
        await agen.__anext__()
        for _ in range(3):
            call_context.bump()
        with pytest.raises(RuntimeError):
            await agen.athrow(RuntimeError("endpoint blew up"))
        await s.rollback()

    assert await _used(user_id) == 0


async def test_background_work_is_billed_but_charges_nobody_quota(db_session) -> None:
    """Scheduler digests and alert evaluations have no user behind them.

    They never pass through enforce_rate_limit, so no quota moves; but they do
    pass through _record_call, so the money still lands in the ledger. This is
    the decision from the spec, pinned so a future refactor cannot quietly
    reverse either half of it.
    """
    from app.billing import cost

    user_id = await _make_user(tier="pro")
    await cost.record("insight_digest", "gpt-4o", 5_000, 500)

    row = (await db_session.execute(select(AISpendDaily))).scalar_one()
    assert row.feature == "insight_digest"
    assert row.calls == 1
    assert await _used(user_id) == 0


async def test_charged_reconciles_a_block_that_never_saw_the_dependency() -> None:
    """Not every fan-out arrives through enforce_rate_limit — the copilot
    endpoint and the chat plan executor take their unit by hand. `charged`
    is what makes those proportional too."""
    user_id = await _make_user(tier="pro", used=1)  # the up-front unit, already taken
    async with call_context.charged(user_id):
        for _ in range(10):
            call_context.bump()
    assert await _used(user_id) == 10


async def test_charged_joins_a_session_when_it_is_given_one() -> None:
    """Same locking rule as the dependency: with a live transaction in hand the
    charge belongs in it, not on a second connection."""
    user_id = await _make_user(tier="pro", used=1)
    async with AsyncSessionLocal() as s:
        async with call_context.charged(user_id, s):
            for _ in range(5):
                call_context.bump()
        assert await _used(user_id) == 1  # still uncommitted
        await s.commit()
    assert await _used(user_id) == 5


# ─── The tier catalogue the quota numbers come from ───


def test_tier_quotas_match_the_costed_plan() -> None:
    assert tiers.get_tier("free").monthly_quota == 300
    assert tiers.get_tier("pro").monthly_quota == 1600
    assert tiers.get_tier("max").monthly_quota == 8000
    assert tiers.get_tier("max_plus").monthly_quota == 12000


def test_free_dashboards_are_planned_smaller() -> None:
    """Half the questions, half the cost — the free tier's value comes from
    this, not from a bigger number."""
    assert tiers.questions_per_dashboard("free") == 3
    assert tiers.questions_per_dashboard("pro") == 6
    assert tiers.questions_per_dashboard(None) == 3  # unknown key falls back to free


def test_tier_copy_states_the_real_quota() -> None:
    for key in tiers.PURCHASABLE:
        tier = tiers.get_tier(key)
        assert any(str(tier.monthly_quota) in f for f in tier.features), key
    # Max+ is 7.5x Pro, not 10x — the old multiplier would now be a lie.
    assert not any("10x" in f for f in tiers.get_tier("max_plus").features)
    # Max's "(5x)" label has to keep matching the arithmetic it claims.
    assert tiers.get_tier("max").monthly_quota == 5 * tiers.get_tier("pro").monthly_quota


async def test_the_planner_stops_at_the_bound_it_is_given(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The bound is what makes a free dashboard cost ten units instead of
    nineteen, so it has to reach the planner, not just the catalogue."""
    from app.ai import dashboard_planner

    async def fake_chat_json(*_a, **_kw):
        return {"questions": [f"sual {i}" for i in range(8)]}

    monkeypatch.setattr(dashboard_planner, "chat_json", fake_chat_json)
    assert len(await dashboard_planner.plan_dashboard("gəlir", max_questions=3)) == 3
    assert len(await dashboard_planner.plan_dashboard("gəlir")) == 6


async def test_the_copilot_endpoint_is_charged_for_every_completion(
    client, auth, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The copilot tool loop is the largest fan-out in the product — up to
    COPILOT_MAX_STEPS completions — and it takes its quota unit by hand rather
    than through enforce_rate_limit, so the dependency's reconciliation never
    reaches it."""
    from app.ai import copilot

    async def fake_run(message, history, db, cache, user_id, approved_plan=None, client_ip=""):
        for _ in range(6):
            call_context.bump()
        return {"reply": "hazırdır", "actions": [], "steps": 6}

    monkeypatch.setattr(copilot, "run", fake_run)
    resp = await client.post(
        "/api/v1/copilot/chat",
        json={"message": "gəliri göstər", "mode": "execute"},
        headers=auth,
    )
    assert resp.status_code == 200, resp.text

    async with AsyncSessionLocal() as s:
        used = (
            await s.execute(
                select(User.ai_calls_used).where(User.email == "test@nexusbi.io")
            )
        ).scalar_one()
    assert used == 6
