"""AI spend: token→USD arithmetic, the daily ledger, and the budget breaker.

Money is whole micro-USD (1 USD = 1_000_000) everywhere. Prices are quoted per
1M tokens, so ``tokens * price_per_1M`` already *is* micro-USD — there is no
scaling factor to get wrong.
"""
from __future__ import annotations

import time as _time
from datetime import datetime, timezone

from sqlalchemy import func, insert, select, update
from sqlalchemy.exc import IntegrityError

from app.config import settings
from app.core import metrics
from app.core.logging import get_logger
from app.db.session import AsyncSessionLocal
from app.models.ai_spend import AISpendDaily

log = get_logger("nexusbi.cost")


def micro_usd(prompt_tokens: int, completion_tokens: int) -> int:
    """Cost of one completion in whole micro-USD."""
    return round(
        prompt_tokens * settings.AI_PRICE_INPUT_USD_PER_1M
        + completion_tokens * settings.AI_PRICE_OUTPUT_USD_PER_1M
    )


def embed_micro_usd(tokens: int) -> int:
    """Cost of one embedding call — input only, embeddings produce no output."""
    return round(tokens * settings.AI_PRICE_EMBEDDING_USD_PER_1M)


# Today's spend, cached in-process so the breaker costs no query per call. The
# ceiling is a financial soft guard, not a security boundary: with N workers the
# worst overshoot is one TTL window of spend per worker, which is cheaper than a
# database round trip in front of every model call.
_CACHE_TTL_SECONDS = 15.0
_cached: tuple[str, int, float] | None = None  # (iso day, micro_usd, monotonic)
_exhausted_logged = False


def reset_cache() -> None:
    """Drop the cached total — used by tests and when the day rolls over."""
    global _cached, _exhausted_logged
    _cached = None
    _exhausted_logged = False


def _note_spend(micro: int) -> None:
    """Fold a just-written amount into the cache instead of re-querying."""
    global _cached
    if _cached is not None:
        day, total, at = _cached
        _cached = (day, total + micro, at)


async def spent_today_micro() -> int:
    """Micro-USD spent today across the whole deployment."""
    global _cached
    today = datetime.now(timezone.utc).date()
    iso = today.isoformat()
    now = _time.monotonic()
    if _cached is not None:
        day, total, at = _cached
        if day == iso and now - at < _CACHE_TTL_SECONDS:
            return total
    async with AsyncSessionLocal() as session:
        total = (
            await session.execute(
                select(func.coalesce(func.sum(AISpendDaily.micro_usd), 0)).where(
                    AISpendDaily.day == today
                )
            )
        ).scalar_one()
    _cached = (iso, int(total), now)
    return int(total)


async def over_ceiling() -> bool:
    """True when today's spend has reached the configured daily cap."""
    global _exhausted_logged
    ceiling = settings.AI_DAILY_USD_CEILING
    if ceiling <= 0:
        return False
    try:
        spent = await spent_today_micro()
    except Exception as exc:  # noqa: BLE001 — an unreadable ledger must not block AI
        log.warning("ai_spend_read_failed", error=type(exc).__name__, detail=str(exc)[:200])
        return False
    if spent < round(ceiling * 1_000_000):
        return False
    if not _exhausted_logged:
        _exhausted_logged = True
        log.warning(
            "ai_budget_exhausted",
            spent_usd=round(spent / 1_000_000, 4),
            ceiling_usd=ceiling,
        )
    return True


async def record(
    feature: str,
    model: str,
    prompt_tokens: int,
    completion_tokens: int,
    *,
    embedding: bool = False,
) -> None:
    """Add one call to today's ledger row. Never raises.

    Runs in its own session, committed independently of whatever request
    triggered it: the provider charges for the call whether or not the request
    that made it went on to succeed, so a rollback must not erase it.
    """
    spent = (
        embed_micro_usd(prompt_tokens)
        if embedding
        else micro_usd(prompt_tokens, completion_tokens)
    )
    day = datetime.now(timezone.utc).date()
    try:
        async with AsyncSessionLocal() as session:
            bump = (
                update(AISpendDaily)
                .where(
                    AISpendDaily.day == day,
                    AISpendDaily.feature == feature,
                    AISpendDaily.model == model,
                )
                .values(
                    calls=AISpendDaily.calls + 1,
                    prompt_tokens=AISpendDaily.prompt_tokens + prompt_tokens,
                    completion_tokens=AISpendDaily.completion_tokens + completion_tokens,
                    micro_usd=AISpendDaily.micro_usd + spent,
                )
                .execution_options(synchronize_session=False)
            )
            if (await session.execute(bump)).rowcount == 0:
                try:
                    await session.execute(
                        insert(AISpendDaily).values(
                            day=day,
                            feature=feature,
                            model=model,
                            calls=1,
                            prompt_tokens=prompt_tokens,
                            completion_tokens=completion_tokens,
                            micro_usd=spent,
                        )
                    )
                except IntegrityError:
                    # A concurrent first-write-of-the-day won the race; the row
                    # exists now, so the UPDATE that just missed will land.
                    await session.rollback()
                    await session.execute(bump)
            await session.commit()
        _note_spend(spent)
        metrics.ai_cost_usd_total.labels(feature).inc(spent / 1_000_000)
        if settings.AI_DAILY_USD_CEILING > 0:
            remaining = settings.AI_DAILY_USD_CEILING - (await spent_today_micro()) / 1_000_000
            metrics.ai_budget_remaining_usd.set(max(0.0, remaining))
    except Exception as exc:  # noqa: BLE001 — accounting must never fail a request
        log.warning("ai_spend_write_failed", error=type(exc).__name__, detail=str(exc)[:200])
