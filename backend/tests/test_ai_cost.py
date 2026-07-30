"""AI spend accounting: pricing, the daily ledger, and the budget breaker."""
from __future__ import annotations

from datetime import date
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.ai import client as ai_client
from app.billing import cost
from app.config import settings
from app.models.ai_spend import AISpendDaily


def _fake_completion(prompt: int, completion: int, content: str = "{}"):
    """Shape of an OpenAI chat completion, with just the fields we read."""
    return SimpleNamespace(
        usage=SimpleNamespace(
            prompt_tokens=prompt,
            completion_tokens=completion,
            total_tokens=prompt + completion,
        ),
        choices=[
            SimpleNamespace(
                message=SimpleNamespace(content=content), finish_reason="stop"
            )
        ],
    )


def _stub_completions(monkeypatch: pytest.MonkeyPatch, create) -> None:
    monkeypatch.setattr(
        ai_client,
        "get_client",
        lambda: SimpleNamespace(
            chat=SimpleNamespace(completions=SimpleNamespace(create=create))
        ),
    )


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


@pytest.mark.asyncio
async def test_two_calls_accumulate_into_one_row(db_session) -> None:
    await cost.record("text2sql", "gpt-4o", 3_000, 300)
    await cost.record("text2sql", "gpt-4o", 1_000, 100)
    row = (await db_session.execute(select(AISpendDaily))).scalar_one()
    assert row.calls == 2
    assert row.prompt_tokens == 4_000
    assert row.micro_usd == 10_500 + 3_500


@pytest.mark.asyncio
async def test_spend_survives_a_rolled_back_request(db_session) -> None:
    # The money left the account even though the request failed; the ledger must
    # not roll back with it. This is why record() owns its own session.
    await cost.record("insight_generator", "gpt-4o", 2_000, 200)
    await db_session.rollback()
    row = (await db_session.execute(select(AISpendDaily))).scalar_one()
    assert row.calls == 1


@pytest.mark.asyncio
async def test_a_write_failure_never_reaches_the_caller(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def _boom(*_a, **_kw):
        raise RuntimeError("database is on fire")

    monkeypatch.setattr("app.billing.cost.AsyncSessionLocal", _boom)
    await cost.record("text2sql", "gpt-4o", 10, 1)  # must not raise


@pytest.mark.asyncio
async def test_a_completion_lands_in_the_ledger_under_its_feature(
    db_session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "AI_API_KEY", "k")
    monkeypatch.setattr(settings, "AI_MODEL", "gpt-4o")

    async def _create(**_kw):
        return _fake_completion(3_000, 300)

    _stub_completions(monkeypatch, _create)
    await ai_client.chat_json("sys", "usr", feature="text2sql")

    row = (await db_session.execute(select(AISpendDaily))).scalar_one()
    assert row.feature == "text2sql"
    assert row.micro_usd == 10_500
