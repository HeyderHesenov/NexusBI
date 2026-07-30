"""AI spend accounting: pricing, the daily ledger, and the budget breaker."""
from __future__ import annotations

from datetime import date

import pytest
from sqlalchemy import select

from app.billing import cost
from app.config import settings
from app.models.ai_spend import AISpendDaily


@pytest.fixture(autouse=True)
def _prices(monkeypatch: pytest.MonkeyPatch) -> None:
    """gpt-4o list prices as of 2026-07-30, so the numbers below are real."""
    monkeypatch.setattr(settings, "AI_PRICE_INPUT_USD_PER_1M", 2.50)
    monkeypatch.setattr(settings, "AI_PRICE_OUTPUT_USD_PER_1M", 10.00)
    monkeypatch.setattr(settings, "AI_PRICE_EMBEDDING_USD_PER_1M", 0.02)


def test_one_million_input_tokens_costs_the_list_price() -> None:
    # tokens x (USD per 1M) lands directly in micro-USD; no scaling factor needed.
    assert cost.micro_usd(1_000_000, 0) == 2_500_000


def test_output_tokens_are_priced_separately() -> None:
    assert cost.micro_usd(0, 1_000_000) == 10_000_000


def test_a_realistic_call_rounds_to_whole_micro_usd() -> None:
    # 3k in / 300 out — a typical text2sql call.
    assert cost.micro_usd(3_000, 300) == 10_500


def test_embeddings_are_priced_on_input_only() -> None:
    assert cost.embed_micro_usd(1_000_000) == 20_000


def test_unpriced_config_yields_zero_rather_than_crashing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "AI_PRICE_INPUT_USD_PER_1M", 0.0)
    monkeypatch.setattr(settings, "AI_PRICE_OUTPUT_USD_PER_1M", 0.0)
    assert cost.micro_usd(5_000, 500) == 0


@pytest.mark.asyncio
async def test_spend_row_is_keyed_by_day_feature_and_model(db_session) -> None:
    db_session.add(
        AISpendDaily(
            day=date(2026, 7, 30),
            feature="text2sql",
            model="gpt-4o",
            calls=1,
            prompt_tokens=3_000,
            completion_tokens=300,
            micro_usd=10_500,
        )
    )
    await db_session.commit()
    row = (await db_session.execute(select(AISpendDaily))).scalar_one()
    assert (row.day, row.feature, row.model) == (date(2026, 7, 30), "text2sql", "gpt-4o")
    assert row.micro_usd == 10_500
