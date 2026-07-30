"""AI spend accounting: pricing, the daily ledger, and the budget breaker."""
from __future__ import annotations

from datetime import date
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.ai import client as ai_client
from app.billing import cost
from app.config import settings
from app.core.exceptions import AIGenerationError
from app.models.ai_spend import AISpendDaily


@pytest.fixture(autouse=True)
def _clear_spend_cache() -> None:
    """The breaker caches today's total in-process; tests must not inherit it."""
    cost.reset_cache()


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


@pytest.mark.asyncio
async def test_breaker_opens_once_today_exceeds_the_ceiling(
    db_session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "AI_DAILY_USD_CEILING", 1.0)
    assert await cost.over_ceiling() is False
    await cost.record("text2sql", "gpt-4o", 400_000, 40_000)  # $1.40
    cost.reset_cache()
    assert await cost.over_ceiling() is True


@pytest.mark.asyncio
async def test_a_zero_ceiling_disables_the_breaker(
    db_session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "AI_DAILY_USD_CEILING", 0.0)
    await cost.record("text2sql", "gpt-4o", 4_000_000, 400_000)
    cost.reset_cache()
    assert await cost.over_ceiling() is False


@pytest.mark.asyncio
async def test_an_open_breaker_stops_a_completion_before_the_network(
    db_session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "AI_API_KEY", "k")
    monkeypatch.setattr(settings, "AI_MODEL", "gpt-4o")
    monkeypatch.setattr(settings, "AI_DAILY_USD_CEILING", 1.0)
    await cost.record("text2sql", "gpt-4o", 400_000, 40_000)
    cost.reset_cache()

    def _explode():
        raise AssertionError("the breaker must fire before any client is built")

    monkeypatch.setattr(ai_client, "get_client", _explode)
    with pytest.raises(AIGenerationError):
        await ai_client.chat_json("sys", "usr", feature="text2sql")


@pytest.mark.asyncio
async def test_an_open_breaker_sends_embeddings_to_the_offline_fallback(
    db_session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "AI_API_KEY", "k")
    monkeypatch.setattr(settings, "EMBEDDING_MODEL", "text-embedding-3-small")
    monkeypatch.setattr(settings, "AI_DAILY_USD_CEILING", 1.0)
    await cost.record("retrieval", "gpt-4o", 400_000, 40_000)
    cost.reset_cache()

    def _explode():
        raise AssertionError("the breaker must fire before any client is built")

    monkeypatch.setattr(ai_client, "get_client", _explode)
    vectors = await ai_client.embed(["salam"], feature="retrieval")
    assert len(vectors) == 1
    assert len(vectors[0]) == settings.RAG_HASH_DIM


@pytest.mark.asyncio
async def test_completions_are_bounded_by_the_configured_cap(
    db_session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "AI_API_KEY", "k")
    monkeypatch.setattr(settings, "AI_MODEL", "gpt-4o")
    monkeypatch.setattr(settings, "AI_MAX_TOKENS_JSON", 1234)
    seen: dict[str, object] = {}

    async def _create(**kw):
        seen.update(kw)
        return _fake_completion(10, 1)

    _stub_completions(monkeypatch, _create)
    await ai_client.chat_json("sys", "usr", feature="text2sql")
    assert seen["max_tokens"] == 1234


@pytest.mark.asyncio
async def test_a_truncated_json_reply_degrades_instead_of_crashing(
    db_session, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Without this guard max_tokens turns a long answer into a JSONDecodeError
    # and a 500, instead of the deterministic fallback every caller already has.
    monkeypatch.setattr(settings, "AI_API_KEY", "k")
    monkeypatch.setattr(settings, "AI_MODEL", "gpt-4o")

    async def _create(**_kw):
        resp = _fake_completion(10, 1, content='{"questions": ["yarim')
        resp.choices[0].finish_reason = "length"
        return resp

    _stub_completions(monkeypatch, _create)
    with pytest.raises(AIGenerationError):
        await ai_client.chat_json("sys", "usr", feature="dashboard_planner")
