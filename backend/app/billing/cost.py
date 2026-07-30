"""AI spend: token→USD arithmetic, the daily ledger, and the budget breaker.

Money is whole micro-USD (1 USD = 1_000_000) everywhere. Prices are quoted per
1M tokens, so ``tokens * price_per_1M`` already *is* micro-USD — there is no
scaling factor to get wrong.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import insert, update
from sqlalchemy.exc import IntegrityError

from app.config import settings
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


def _note_spend(micro: int) -> None:
    """Fold a just-written amount into the breaker's cache. No-op until the
    breaker exists; kept here so ``record`` is complete on its own."""


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
    except Exception as exc:  # noqa: BLE001 — accounting must never fail a request
        log.warning("ai_spend_write_failed", error=type(exc).__name__, detail=str(exc)[:200])
