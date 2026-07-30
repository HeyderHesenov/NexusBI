"""AI spend: token→USD arithmetic, the daily ledger, and the budget breaker.

Money is whole micro-USD (1 USD = 1_000_000) everywhere. Prices are quoted per
1M tokens, so ``tokens * price_per_1M`` already *is* micro-USD — there is no
scaling factor to get wrong.
"""
from __future__ import annotations

from app.config import settings


def micro_usd(prompt_tokens: int, completion_tokens: int) -> int:
    """Cost of one completion in whole micro-USD."""
    return round(
        prompt_tokens * settings.AI_PRICE_INPUT_USD_PER_1M
        + completion_tokens * settings.AI_PRICE_OUTPUT_USD_PER_1M
    )


def embed_micro_usd(tokens: int) -> int:
    """Cost of one embedding call — input only, embeddings produce no output."""
    return round(tokens * settings.AI_PRICE_EMBEDDING_USD_PER_1M)
