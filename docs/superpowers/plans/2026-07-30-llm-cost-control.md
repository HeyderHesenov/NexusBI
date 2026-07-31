# LLM Cost Control (Faza 1.4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop an AI request from costing the operator more than the plan it was sold under — by bounding each call, charging quota in proportion to the model calls actually made, and cutting spend off at a daily USD ceiling.

**Architecture:** `app/ai/client.py` is already the single choke point — three of its four entry points call `_require_configured()` and all four end in `_record_call()`. The breaker extends the first; spend accounting extends the second. Quota becomes proportional via a contextvar counter incremented in `_record_call` and reconciled in a `yield`-style FastAPI dependency. Spend lives in one daily aggregate row per `(day, feature, model)`, written in its own short-lived session so a rolled-back request cannot erase money that was actually spent.

**Tech Stack:** Python 3.10, FastAPI, SQLAlchemy 2 async, Alembic, pytest + pytest-asyncio, prometheus_client. DB is SQLite (dev/test) and PostgreSQL (prod) — every statement must work on both.

**Spec:** `docs/superpowers/specs/2026-07-30-llm-cost-control-design.md`

## Global Constraints

- Money is stored as **whole integer micro-USD** (`1 USD = 1_000_000`). Never floats in the DB.
- Spend accounting must **never fail a user request**. Every failure path logs and continues.
- Quota counts **completions only** (`chat_json`, `chat_text`, `chat_tools`). `embed` is excluded from quota but included in USD spend.
- The breaker raises the **existing** `AIGenerationError`; no new fallback code is written anywhere.
- Every statement must run on **both SQLite and PostgreSQL**.
- Backend lint gate is exactly `ruff check --select F app` run from `backend/`. Do not run `ruff check .`.
- Local test runs need `DIGEST_ENABLED=true` (repo `.env` sets it false, which fails `test_digest.py`).
- Run backend tests from `backend/`: `DIGEST_ENABLED=true python -m pytest -q`.
- Tier feature strings live only in `backend/app/billing/tiers.py` and are Azerbaijani. Frontend reads them from the API — do not add frontend copy.

---

### Task 1: Cost arithmetic and config knobs

**Files:**
- Create: `backend/app/billing/cost.py`
- Modify: `backend/app/config.py` (AI engine block, after `EMBEDDING_MODEL` on line 25)
- Test: `backend/tests/test_ai_cost.py`

**Interfaces:**
- Consumes: `app.config.settings`
- Produces: `cost.micro_usd(prompt_tokens: int, completion_tokens: int) -> int`, `cost.embed_micro_usd(tokens: int) -> int`, and settings `AI_PRICE_INPUT_USD_PER_1M: float`, `AI_PRICE_OUTPUT_USD_PER_1M: float`, `AI_PRICE_EMBEDDING_USD_PER_1M: float`, `AI_DAILY_USD_CEILING: float`, `AI_MAX_TOKENS_JSON: int`, `AI_MAX_TOKENS_TEXT: int`, `AI_MAX_TOKENS_TOOLS: int`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_ai_cost.py`:

```python
"""AI spend accounting: pricing, the daily ledger, and the budget breaker."""
from __future__ import annotations

import pytest

from app.billing import cost
from app.config import settings


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
```

- [ ] **Step 2: Run the test and watch it fail**

Run from `backend/`: `DIGEST_ENABLED=true python -m pytest tests/test_ai_cost.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.billing.cost'`

- [ ] **Step 3: Add the config knobs**

In `backend/app/config.py`, directly after the `EMBEDDING_MODEL` line in the `─── AI engine ───` block:

```python
    # ─── AI spend control ───
    # Prices are USD per 1M tokens, copied from the engine's pricing page. Left at
    # 0 the cost of every call computes to zero, which silently disables the
    # ceiling — main.py warns loudly when a ceiling is set without prices.
    AI_PRICE_INPUT_USD_PER_1M: float = Field(default=0.0)
    AI_PRICE_OUTPUT_USD_PER_1M: float = Field(default=0.0)
    AI_PRICE_EMBEDDING_USD_PER_1M: float = Field(default=0.0)
    # Whole-deployment daily spend cap. 0 disables the breaker entirely.
    AI_DAILY_USD_CEILING: float = Field(default=10.0)
    # Upper bound per completion. Structured generators need room for the JSON
    # body; prose is capped tighter because it is read by a human.
    AI_MAX_TOKENS_JSON: int = Field(default=1500)
    AI_MAX_TOKENS_TEXT: int = Field(default=800)
    AI_MAX_TOKENS_TOOLS: int = Field(default=1500)
```

- [ ] **Step 4: Write the cost module**

Create `backend/app/billing/cost.py`:

```python
"""AI spend: token→USD arithmetic, the daily ledger, and the budget breaker.

Money is whole micro-USD (1 USD = 1_000_000) everywhere. Prices are quoted per
1M tokens, so `tokens * price_per_1M` already *is* micro-USD — there is no
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
```

- [ ] **Step 5: Run the test and watch it pass**

Run from `backend/`: `DIGEST_ENABLED=true python -m pytest tests/test_ai_cost.py -q`
Expected: PASS, 5 tests

- [ ] **Step 6: Commit**

```bash
git add backend/app/billing/cost.py backend/app/config.py backend/tests/test_ai_cost.py
git commit -m "feat(cost): price an AI call in whole micro-USD"
```

---

### Task 2: The daily spend table

**Files:**
- Create: `backend/app/models/ai_spend.py`
- Create: `backend/app/db/migrations/versions/f1a2b3c4d5e6_add_ai_spend_daily.py`
- Modify: `backend/app/models/__init__.py`
- Test: `backend/tests/test_ai_cost.py`

**Interfaces:**
- Consumes: `app.db.base.Base`
- Produces: `AISpendDaily` with columns `day: date`, `feature: str`, `model: str`, `calls: int`, `prompt_tokens: int`, `completion_tokens: int`, `micro_usd: int`. Composite primary key `(day, feature, model)`.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_ai_cost.py`:

```python
from datetime import date, timezone

from sqlalchemy import select

from app.models.ai_spend import AISpendDaily


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
```

- [ ] **Step 2: Run the test and watch it fail**

Run from `backend/`: `DIGEST_ENABLED=true python -m pytest tests/test_ai_cost.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.models.ai_spend'`

- [ ] **Step 3: Write the model**

Create `backend/app/models/ai_spend.py`:

```python
"""Daily AI spend, aggregated per feature and model.

One row per (day, feature, model) rather than one per call: the operator's
questions are "what did today cost" and "which feature is eating it", and both
are answered by a table that stays a few dozen rows a day and needs no
retention policy. Per-user attribution is deliberately absent — that arrives
with billing in Faza 3.
"""
from __future__ import annotations

from datetime import date

from sqlalchemy import BigInteger, Date, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class AISpendDaily(Base):
    __tablename__ = "ai_spend_daily"

    day: Mapped[date] = mapped_column(Date, primary_key=True)
    feature: Mapped[str] = mapped_column(String(40), primary_key=True)
    model: Mapped[str] = mapped_column(String(80), primary_key=True)
    calls: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    prompt_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    completion_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # BigInteger: a $2100 day overflows a 32-bit micro-USD column.
    micro_usd: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
```

- [ ] **Step 4: Register the model**

In `backend/app/models/__init__.py`, add the import after the `alert` import line:

```python
from app.models.ai_spend import AISpendDaily
```

and add `"AISpendDaily",` to the `__all__` list.

- [ ] **Step 5: Write the migration**

Create `backend/app/db/migrations/versions/f1a2b3c4d5e6_add_ai_spend_daily.py`:

```python
"""add ai_spend_daily

Revision ID: f1a2b3c4d5e6
Revises: a4b5c6d7e8f9
Create Date: 2026-07-30 14:00:00.000000
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = 'f1a2b3c4d5e6'
down_revision: str | None = 'a4b5c6d7e8f9'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'ai_spend_daily',
        sa.Column('day', sa.Date(), nullable=False),
        sa.Column('feature', sa.String(length=40), nullable=False),
        sa.Column('model', sa.String(length=80), nullable=False),
        sa.Column('calls', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('prompt_tokens', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('completion_tokens', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('micro_usd', sa.BigInteger(), nullable=False, server_default='0'),
        sa.PrimaryKeyConstraint('day', 'feature', 'model'),
    )


def downgrade() -> None:
    op.drop_table('ai_spend_daily')
```

- [ ] **Step 6: Verify the migration head is linear**

Run from `backend/`: `python -c "
import pathlib, re
revs, downs = set(), set()
for p in pathlib.Path('app/db/migrations/versions').glob('*.py'):
    t = p.read_text()
    revs |= set(re.findall(r\"^revision: str = '([^']+)'\", t, re.M))
    downs |= set(re.findall(r\"^down_revision: str \| None = '([^']+)'\", t, re.M))
print('heads:', revs - downs)
"`
Expected: `heads: {'f1a2b3c4d5e6'}` — exactly one head.

- [ ] **Step 7: Run the test and watch it pass**

Run from `backend/`: `DIGEST_ENABLED=true python -m pytest tests/test_ai_cost.py -q`
Expected: PASS, 6 tests

- [ ] **Step 8: Commit**

```bash
git add backend/app/models/ai_spend.py backend/app/models/__init__.py \
        backend/app/db/migrations/versions/f1a2b3c4d5e6_add_ai_spend_daily.py \
        backend/tests/test_ai_cost.py
git commit -m "feat(cost): a daily spend row per feature and model"
```

---

### Task 3: Record spend outside the request transaction

**Files:**
- Modify: `backend/app/billing/cost.py`
- Test: `backend/tests/test_ai_cost.py`

**Interfaces:**
- Consumes: `cost.micro_usd`, `AISpendDaily`, `app.db.session.AsyncSessionLocal`
- Produces: `async cost.record(feature: str, model: str, prompt_tokens: int, completion_tokens: int, *, embedding: bool = False) -> None`

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_ai_cost.py`:

```python
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
    # The money left the account even though the request failed; the ledger
    # must not roll back with it. This is why record() owns its own session.
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
```

- [ ] **Step 2: Run the test and watch it fail**

Run from `backend/`: `DIGEST_ENABLED=true python -m pytest tests/test_ai_cost.py -q`
Expected: FAIL — `AttributeError: module 'app.billing.cost' has no attribute 'record'`

- [ ] **Step 3: Implement recording**

Add to `backend/app/billing/cost.py` — imports at the top:

```python
from datetime import datetime, timezone

from sqlalchemy import insert, update
from sqlalchemy.exc import IntegrityError

from app.core.logging import get_logger
from app.db.session import AsyncSessionLocal
from app.models.ai_spend import AISpendDaily

log = get_logger("nexusbi.cost")
```

and the function:

```python
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
        embed_micro_usd(prompt_tokens) if embedding
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
```

Also add this no-op hook, so `record` is complete on its own and Task 5 has a seam to
fill rather than a line to insert:

```python
def _note_spend(micro: int) -> None:
    """Fold a just-written amount into the breaker's cache. No-op until Task 5."""
```

- [ ] **Step 4: Run the test and watch it pass**

Run from `backend/`: `DIGEST_ENABLED=true python -m pytest tests/test_ai_cost.py -q`
Expected: PASS, 9 tests

- [ ] **Step 5: Commit**

```bash
git add backend/app/billing/cost.py backend/tests/test_ai_cost.py
git commit -m "feat(cost): record spend in its own session so a rollback can't erase it"
```

---

### Task 4: Wire spend recording into the AI client

**Files:**
- Modify: `backend/app/ai/client.py` (`chat_json`, `chat_text`, `chat_tools`, `embed`, `_record_call`)
- Test: `backend/tests/test_ai_cost.py`

**Interfaces:**
- Consumes: `cost.record`
- Produces: `feature: str = "unknown"` keyword argument on `chat_json`, `chat_text`, `chat_tools`, `embed`; `_record_call(resp, started, kind, feature, *, embedding=False)`

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_ai_cost.py`:

```python
from types import SimpleNamespace

from app.ai import client as ai_client


def _fake_completion(prompt: int, completion: int, content: str = "{}"):
    return SimpleNamespace(
        usage=SimpleNamespace(
            prompt_tokens=prompt, completion_tokens=completion,
            total_tokens=prompt + completion,
        ),
        choices=[SimpleNamespace(message=SimpleNamespace(content=content), finish_reason="stop")],
    )


@pytest.mark.asyncio
async def test_a_completion_lands_in_the_ledger_under_its_feature(
    db_session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "AI_API_KEY", "k")
    monkeypatch.setattr(settings, "AI_MODEL", "gpt-4o")

    async def _create(**_kw):
        return _fake_completion(3_000, 300)

    monkeypatch.setattr(
        ai_client, "get_client",
        lambda: SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=_create))),
    )
    await ai_client.chat_json("sys", "usr", feature="text2sql")

    row = (await db_session.execute(select(AISpendDaily))).scalar_one()
    assert row.feature == "text2sql"
    assert row.micro_usd == 10_500
```

- [ ] **Step 2: Run the test and watch it fail**

Run from `backend/`: `DIGEST_ENABLED=true python -m pytest tests/test_ai_cost.py -q`
Expected: FAIL — `TypeError: chat_json() got an unexpected keyword argument 'feature'`

- [ ] **Step 3: Thread `feature` through the client**

In `backend/app/ai/client.py`, add `feature: str = "unknown"` to the keyword-only block of `chat_json`, `chat_text` and `chat_tools`, and to `embed`. Pass it into `_record_call`. Example for `chat_json`:

```python
async def chat_json(
    system: str,
    user: str,
    *,
    temperature: float = 0.0,
    localize: bool = False,
    feature: str = "unknown",
) -> dict[str, Any]:
```

and its recording line becomes:

```python
    await _record_call(resp, started, "json", feature)
```

Do the same for `chat_text` (`"text"`), `chat_tools` (`"tools"`) and `embed` (`"embed"`, plus `embedding=True`).

- [ ] **Step 4: Make `_record_call` async and record spend**

Replace `_record_call` in `backend/app/ai/client.py`:

```python
async def _record_call(
    resp: Any, started: float, kind: str, feature: str, *, embedding: bool = False
) -> None:
    """Log, count and cost an AI call."""
    elapsed = time.perf_counter() - started
    usage = getattr(resp, "usage", None)
    prompt_tokens = getattr(usage, "prompt_tokens", 0) or 0
    completion_tokens = getattr(usage, "completion_tokens", 0) or 0
    tokens = getattr(usage, "total_tokens", None)
    log.info(
        "ai_call",
        model=settings.AI_MODEL,
        tokens_used=tokens,
        latency_ms=int(elapsed * 1000),
        kind=kind,
        feature=feature,
    )
    metrics.ai_calls_total.labels(kind).inc()
    metrics.ai_latency_seconds.labels(kind).observe(elapsed)
    if tokens:
        metrics.ai_tokens_total.inc(tokens)
    await cost.record(
        feature, settings.AI_MODEL, prompt_tokens, completion_tokens, embedding=embedding
    )
```

Add the import at the top of `client.py`:

```python
from app.billing import cost
```

- [ ] **Step 5: Run the test and watch it pass**

Run from `backend/`: `DIGEST_ENABLED=true python -m pytest tests/test_ai_cost.py -q`
Expected: PASS, 10 tests

- [ ] **Step 6: Run the whole backend suite for import cycles**

Run from `backend/`: `DIGEST_ENABLED=true python -m pytest -q`
Expected: PASS. `app.billing.cost` imports `app.db.session` and `app.models`; if this raises a circular import, move the `cost` import inside `_record_call`.

- [ ] **Step 7: Commit**

```bash
git add backend/app/ai/client.py backend/tests/test_ai_cost.py
git commit -m "feat(cost): meter every model call into the daily ledger"
```

---

### Task 5: The daily ceiling and its breaker

**Files:**
- Modify: `backend/app/billing/cost.py`
- Modify: `backend/app/ai/client.py` (`_require_configured` → `_preflight`, and `embed`)
- Test: `backend/tests/test_ai_cost.py`

**Interfaces:**
- Consumes: `AISpendDaily`, `settings.AI_DAILY_USD_CEILING`
- Produces: `async cost.spent_today_micro() -> int`, `async cost.over_ceiling() -> bool`, `cost.reset_cache() -> None`; `async client._preflight() -> None` replacing `_require_configured()`

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_ai_cost.py`:

```python
from app.core.exceptions import AIGenerationError


@pytest.fixture(autouse=True)
def _clear_spend_cache() -> None:
    cost.reset_cache()


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
    vectors = await ai_client.embed(["salam"])
    assert len(vectors) == 1
    assert len(vectors[0]) == settings.RAG_HASH_DIM
```

- [ ] **Step 2: Run the test and watch it fail**

Run from `backend/`: `DIGEST_ENABLED=true python -m pytest tests/test_ai_cost.py -q`
Expected: FAIL — `AttributeError: module 'app.billing.cost' has no attribute 'reset_cache'`

- [ ] **Step 3: Implement the breaker**

Add to `backend/app/billing/cost.py` — imports:

```python
import time as _time

from sqlalchemy import func, select
```

and replace the `_note_spend` placeholder with:

```python
# Today's spend, cached in-process so the breaker costs no query per call. The
# ceiling is a financial soft guard, not a security boundary: with N workers the
# worst overshoot is one TTL window of spend per worker, which is cheaper than a
# database round trip in front of every model call.
_CACHE_TTL_SECONDS = 15.0
_cached: tuple[str, int, float] | None = None  # (iso day, micro_usd, monotonic)
_exhausted_logged = False


def reset_cache() -> None:
    """Drop the cached total — used by tests and after the day rolls over."""
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
    today = datetime.now(timezone.utc).date().isoformat()
    now = _time.monotonic()
    if _cached is not None:
        day, total, at = _cached
        if day == today and now - at < _CACHE_TTL_SECONDS:
            return total
    async with AsyncSessionLocal() as session:
        total = (
            await session.execute(
                select(func.coalesce(func.sum(AISpendDaily.micro_usd), 0)).where(
                    AISpendDaily.day == datetime.now(timezone.utc).date()
                )
            )
        ).scalar_one()
    _cached = (today, int(total), now)
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
```

- [ ] **Step 4: Turn `_require_configured` into `_preflight`**

In `backend/app/ai/client.py`, replace `_require_configured` (keeping its docstring, extended):

```python
async def _preflight() -> None:
    """Refuse the call before it reaches the network, for either reason.

    Callers already treat ``AIGenerationError`` as "take the deterministic
    path", so a keyless run and an exhausted budget land on the same fallback —
    which is exactly why the breaker raises it rather than inventing a second
    degradation mode. Reaching the fallback via the SDK instead would cost a
    connection attempt plus ``max_retries`` backoff *per call*.
    """
    if not settings.AI_API_KEY or not settings.AI_MODEL:
        raise AIGenerationError("AI xidməti əlçatmazdır.")
    if await cost.over_ceiling():
        raise AIGenerationError("AI xidməti əlçatmazdır.")
```

Change the three call sites from `_require_configured()` to `await _preflight()`.

In `embed`, change the guard to fall back offline when the budget is gone:

```python
    if not settings.AI_API_KEY or not settings.EMBEDDING_MODEL or await cost.over_ceiling():
        return [_hash_embed(t) for t in texts]
```

- [ ] **Step 5: Run the test and watch it pass**

Run from `backend/`: `DIGEST_ENABLED=true python -m pytest tests/test_ai_cost.py -q`
Expected: PASS, 14 tests

- [ ] **Step 6: Run the whole suite**

Run from `backend/`: `DIGEST_ENABLED=true python -m pytest -q`
Expected: PASS. Any test that patched `_require_configured` must be updated to `_preflight`.

- [ ] **Step 7: Commit**

```bash
git add backend/app/billing/cost.py backend/app/ai/client.py backend/tests/test_ai_cost.py
git commit -m "feat(cost): cut AI over to deterministic fallbacks at the daily ceiling"
```

---

### Task 6: Bound every completion with max_tokens

**Files:**
- Modify: `backend/app/ai/client.py` (`chat_json`, `chat_text`, `chat_tools`)
- Modify: `backend/tests/test_architecture.py`
- Test: `backend/tests/test_ai_cost.py`

**Interfaces:**
- Consumes: `settings.AI_MAX_TOKENS_JSON`, `AI_MAX_TOKENS_TEXT`, `AI_MAX_TOKENS_TOOLS`
- Produces: `max_tokens: int | None = None` keyword argument on the three completion helpers

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_ai_cost.py`:

```python
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

    monkeypatch.setattr(
        ai_client, "get_client",
        lambda: SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=_create))),
    )
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

    monkeypatch.setattr(
        ai_client, "get_client",
        lambda: SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=_create))),
    )
    with pytest.raises(AIGenerationError):
        await ai_client.chat_json("sys", "usr", feature="dashboard_planner")
```

- [ ] **Step 2: Run the test and watch it fail**

Run from `backend/`: `DIGEST_ENABLED=true python -m pytest tests/test_ai_cost.py -q`
Expected: FAIL — `KeyError: 'max_tokens'`

- [ ] **Step 3: Pass max_tokens and guard truncation**

In `chat_json`, add `max_tokens: int | None = None` to the keyword block, pass it to the SDK, and guard the reply:

```python
        resp = await get_client().chat.completions.create(
            model=settings.AI_MODEL,
            temperature=temperature,
            max_tokens=max_tokens or settings.AI_MAX_TOKENS_JSON,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        )
    except (APIError, OpenAIError) as exc:
        raise _map_ai_error(exc) from exc
    await _record_call(resp, started, "json", feature)
    if resp.choices[0].finish_reason == "length":
        # The body is cut mid-token, so json.loads would raise and surface as a
        # 500. Degrade the way every other AI failure here degrades instead.
        log.warning("ai_response_truncated", kind="json", feature=feature)
        raise AIGenerationError("AI xidməti əlçatmazdır.")
    content = resp.choices[0].message.content or "{}"
    return json.loads(content)
```

Do the same for `chat_text` (`AI_MAX_TOKENS_TEXT`, no truncation guard — a clipped sentence is still usable prose) and `chat_tools` (`AI_MAX_TOKENS_TOOLS`, no guard — the caller inspects `.tool_calls`).

- [ ] **Step 4: Add the architecture ratchet**

Append to `backend/tests/test_architecture.py`:

```python
def test_every_completion_is_bounded_by_max_tokens() -> None:
    """An unbounded completion is an unbounded bill.

    The three helpers in ai/client.py are the only places allowed to call the
    SDK, and each must pass max_tokens. A new helper that forgets fails here.
    """
    import pathlib
    import re

    source = pathlib.Path("app/ai/client.py").read_text()
    creates = re.findall(
        r"chat\.completions\.create\((.*?)\n        \)", source, re.S
    )
    assert creates, "no chat.completions.create call found — did the file move?"
    missing = [c for c in creates if "max_tokens" not in c]
    assert not missing, (
        "every chat.completions.create must pass max_tokens; "
        f"{len(missing)} call(s) do not"
    )
```

- [ ] **Step 5: Run the tests and watch them pass**

Run from `backend/`: `DIGEST_ENABLED=true python -m pytest tests/test_ai_cost.py tests/test_architecture.py -q`
Expected: PASS

- [ ] **Step 6: Run the whole suite**

Run from `backend/`: `DIGEST_ENABLED=true python -m pytest -q`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add backend/app/ai/client.py backend/tests/test_ai_cost.py backend/tests/test_architecture.py
git commit -m "feat(cost): bound every completion, and degrade when one is truncated"
```

---

### Task 7: Thread the feature name through the 12 AI modules

**Files:**
- Modify: `backend/app/ai/text2sql.py`, `text2dax.py`, `chart_selector.py`, `insight_generator.py`, `insight_digest.py`, `dashboard_planner.py`, `data_prep.py`, `data_story.py`, `root_cause.py`, `requirements.py`, `ba_frameworks.py`, `copilot.py`, `retrieval.py`
- Test: `backend/tests/test_architecture.py`

**Interfaces:**
- Consumes: the `feature` keyword from Task 4
- Produces: no new API — every `chat_*` / `embed` call site names its feature

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_architecture.py`:

```python
def test_ai_call_sites_name_their_feature() -> None:
    """Unattributed spend is spend you cannot act on.

    Every chat_*/embed call outside client.py must pass feature=..., otherwise
    its cost lands in the ledger under "unknown" and the operator cannot tell
    which part of the product is expensive.
    """
    import pathlib
    import re

    offenders: list[str] = []
    for path in pathlib.Path("app").rglob("*.py"):
        if path.name == "client.py":
            continue
        text = path.read_text()
        for match in re.finditer(r"\b(chat_json|chat_text|chat_tools|embed)\((.*?)\)", text, re.S):
            if "feature=" not in match.group(2):
                offenders.append(f"{path}: {match.group(1)}")
    assert not offenders, "AI calls without feature=: " + ", ".join(sorted(offenders))
```

- [ ] **Step 2: Run the test and watch it fail**

Run from `backend/`: `DIGEST_ENABLED=true python -m pytest tests/test_architecture.py -q`
Expected: FAIL, listing every unattributed call site

- [ ] **Step 3: Add `feature=` at each call site**

Use the module's own name as the value. For example in `backend/app/ai/dashboard_planner.py`:

```python
        raw = await chat_json(
            DASHBOARD_PLANNER_PROMPT, user, temperature=0.4, feature="dashboard_planner"
        )
```

and in `backend/app/ai/retrieval.py`:

```python
    vecs = await client.embed([text], feature="retrieval")
```

Work through the failures the test reports until the list is empty. Feature names are the module stems: `text2sql`, `text2dax`, `chart_selector`, `insight_generator`, `insight_digest`, `dashboard_planner`, `data_prep`, `data_story`, `root_cause`, `requirements`, `ba_frameworks`, `copilot`, `retrieval`.

- [ ] **Step 4: Run the test and watch it pass**

Run from `backend/`: `DIGEST_ENABLED=true python -m pytest tests/test_architecture.py -q`
Expected: PASS

- [ ] **Step 5: Run the whole suite and the lint gate**

Run from `backend/`: `DIGEST_ENABLED=true python -m pytest -q && ruff check --select F app`
Expected: PASS, no lint findings

- [ ] **Step 6: Commit**

```bash
git add backend/app/ai backend/tests/test_architecture.py
git commit -m "feat(cost): attribute every model call to the feature that made it"
```

---

### Task 8: Make the quota counter atomic

**Files:**
- Modify: `backend/app/billing/usage_service.py`
- Test: `backend/tests/test_usage_quota.py`

**Interfaces:**
- Consumes: `app.models.user.User`, `app.billing.tiers`
- Produces: `async usage_service.check_and_consume(db, user) -> None` (unchanged signature, now atomic), `async usage_service.consume_extra(user_id: str, units: int) -> None`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_usage_quota.py`:

```python
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


@pytest.mark.asyncio
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


@pytest.mark.asyncio
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


@pytest.mark.asyncio
async def test_an_elapsed_window_resets_the_counter_in_the_same_statement() -> None:
    user_id = await _make_user(used=tiers.get_tier("free").monthly_quota)
    async with AsyncSessionLocal() as s:
        user = (await s.execute(select(User).where(User.id == user_id))).scalar_one()
        user.usage_period_start = datetime.now(timezone.utc) - timedelta(days=31)
        await s.commit()
        await usage_service.check_and_consume(s, user)
        await s.commit()
    assert await _used(user_id) == 1


@pytest.mark.asyncio
async def test_extra_units_are_charged_unconditionally() -> None:
    """The calls already happened; the charge cannot be refused."""
    user_id = await _make_user(used=29)
    await usage_service.consume_extra(user_id, 18)
    assert await _used(user_id) == 47
```

- [ ] **Step 2: Run the test and watch it fail**

Run from `backend/`: `DIGEST_ENABLED=true python -m pytest tests/test_usage_quota.py -q`
Expected: FAIL — `test_concurrent_consumers_do_not_lose_an_increment` asserts 2, gets 1

- [ ] **Step 3: Rewrite `check_and_consume` atomically**

In `backend/app/billing/usage_service.py`, replace `_reset_if_expired` and `check_and_consume`. Add imports:

```python
from sqlalchemy import case, or_, update

from app.core.logging import get_logger
from app.db.session import AsyncSessionLocal

log = get_logger("nexusbi.usage")
```

```python
def _window_elapsed(cutoff: datetime):
    """SQL predicate: this user's 30-day window has lapsed (or never started)."""
    return or_(User.usage_period_start.is_(None), User.usage_period_start <= cutoff)


async def check_and_consume(db: AsyncSession, user: User) -> None:
    """Reset the window if elapsed, enforce the tier quota, consume one call.

    One statement, not read-modify-write: two requests arriving together used to
    read the same count and write the same +1, so one of the two calls was free.
    The window reset rides along in CASE expressions, which see the column's
    pre-update value — exactly the "has it lapsed?" question being asked.
    """
    if is_unlimited(user.subscription_tier):
        return  # demo/test account — no counting, no limit
    now = datetime.now(timezone.utc)
    cutoff = now - PERIOD
    quota = get_tier(user.subscription_tier).monthly_quota
    elapsed = _window_elapsed(cutoff)
    result = await db.execute(
        update(User)
        .where(User.id == user.id, or_(elapsed, User.ai_calls_used + 1 <= quota))
        .values(
            usage_period_start=case((elapsed, now), else_=User.usage_period_start),
            ai_calls_used=case((elapsed, 1), else_=User.ai_calls_used + 1),
        )
        .execution_options(synchronize_session=False)
    )
    if result.rowcount == 0:
        raise RateLimitError(
            "Aylıq AI sorğu limitiniz doldu.",
            detail="Daha çox sorğu üçün planınızı yüksəldin.",
            code="ai_quota",
        )
    await db.flush()
    await db.refresh(user)


async def consume_extra(user_id: str, units: int) -> None:
    """Charge `units` more, unconditionally — those calls already cost money.

    Its own session on purpose: this runs after the endpoint returned, when the
    request's transaction may already be finished, and the charge must land
    whether or not the request itself succeeded.
    """
    if units <= 0:
        return
    try:
        async with AsyncSessionLocal() as session:
            await session.execute(
                update(User)
                .where(User.id == user_id)
                .values(ai_calls_used=User.ai_calls_used + units)
                .execution_options(synchronize_session=False)
            )
            await session.commit()
    except Exception as exc:  # noqa: BLE001 — never fail a response over accounting
        log.warning("quota_reconcile_failed", error=type(exc).__name__, detail=str(exc)[:200])
```

- [ ] **Step 4: Run the test and watch it pass**

Run from `backend/`: `DIGEST_ENABLED=true python -m pytest tests/test_usage_quota.py -q`
Expected: PASS, 4 tests

- [ ] **Step 5: Run the whole suite**

Run from `backend/`: `DIGEST_ENABLED=true python -m pytest -q`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/app/billing/usage_service.py backend/tests/test_usage_quota.py
git commit -m "fix(quota): stop losing increments between concurrent requests"
```

---

### Task 9: Charge quota in proportion to model calls

**Files:**
- Create: `backend/app/ai/call_context.py`
- Modify: `backend/app/ai/client.py` (`_record_call`)
- Modify: `backend/app/dependencies.py:51-61`
- Test: `backend/tests/test_usage_quota.py`

**Interfaces:**
- Consumes: `usage_service.consume_extra`, `usage_service.check_and_consume`
- Produces: `call_context.begin() -> Token`, `call_context.bump() -> None`, `call_context.count() -> int`, `call_context.end(token) -> None`; `enforce_rate_limit` becomes an async generator dependency yielding `User`

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_usage_quota.py`:

```python
from app.ai import call_context


def test_the_counter_is_per_request_and_restores_cleanly() -> None:
    token = call_context.begin()
    call_context.bump()
    call_context.bump()
    assert call_context.count() == 2
    call_context.end(token)
    assert call_context.count() == 0


@pytest.mark.asyncio
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


@pytest.mark.asyncio
async def test_calls_are_still_charged_when_the_endpoint_raises() -> None:
    """A request that dies halfway already spent whatever it spent."""
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


@pytest.mark.asyncio
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
```

Add these imports at the top of the file for the block above:

```python
from app.models.ai_spend import AISpendDaily
```

- [ ] **Step 2: Run the test and watch it fail**

Run from `backend/`: `DIGEST_ENABLED=true python -m pytest tests/test_usage_quota.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.ai.call_context'`

- [ ] **Step 3: Write the counter**

Create `backend/app/ai/call_context.py`:

```python
"""How many completions the request currently being served has made.

Quota used to cost one unit per HTTP request, which made /dashboard/generate —
a planner plus six questions at three completions each — as cheap as asking a
single question. Counting here, at the one place every completion passes
through, is what makes the charge proportional to what was actually spent.

Embeddings are deliberately not counted: at $0.02 per 1M tokens against a
completion's $2.50 they are rounding error, and charging a full unit for one
would bill a three-completion question as five.
"""
from __future__ import annotations

from contextvars import ContextVar, Token

_completions: ContextVar[int] = ContextVar("ai_completions", default=0)


def begin() -> Token[int]:
    """Start counting for one request. Pass the token back to `end`."""
    return _completions.set(0)


def bump() -> None:
    _completions.set(_completions.get() + 1)


def count() -> int:
    return _completions.get()


def end(token: Token[int]) -> None:
    _completions.reset(token)
```

- [ ] **Step 4: Count completions in the client**

In `backend/app/ai/client.py`, inside `_record_call`, after the metrics lines:

```python
    if not embedding:
        call_context.bump()
```

and import at the top:

```python
from app.ai import call_context
```

- [ ] **Step 5: Reconcile in the dependency**

Replace `enforce_rate_limit` in `backend/app/dependencies.py`:

```python
async def enforce_rate_limit(
    user: Annotated[User, Depends(get_current_user)], db: DbDep
) -> AsyncGenerator[User, None]:
    """Consume monthly AI quota in proportion to the model calls actually made.

    One unit is taken up front so an exhausted user is refused before any work
    starts; the rest is charged on the way out, once the endpoint has finished
    and the real count is known. The charge happens even when the endpoint
    raised — the calls it made before failing still cost money.
    """
    from app.ai import call_context
    from app.billing import usage_service

    await usage_service.check_and_consume(db, user)
    token = call_context.begin()
    try:
        yield user
    finally:
        extra = max(0, call_context.count() - 1)
        call_context.end(token)
        if extra:
            await usage_service.consume_extra(user.id, extra)
```

Add the import at the top of `dependencies.py`:

```python
from collections.abc import AsyncGenerator
```

- [ ] **Step 6: Run the test and watch it pass**

Run from `backend/`: `DIGEST_ENABLED=true python -m pytest tests/test_usage_quota.py -q`
Expected: PASS, 6 tests

- [ ] **Step 7: Run the whole suite**

Run from `backend/`: `DIGEST_ENABLED=true python -m pytest -q`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add backend/app/ai/call_context.py backend/app/ai/client.py \
        backend/app/dependencies.py backend/tests/test_usage_quota.py
git commit -m "feat(quota): charge a request for the model calls it actually made"
```

---

### Task 10: Reprice the tiers and cheapen the free dashboard

**Files:**
- Modify: `backend/app/billing/tiers.py`
- Modify: `backend/app/ai/dashboard_planner.py`
- Modify: `backend/app/services/dashboard_service.py` (`generate_dashboard`)
- Test: `backend/tests/test_usage_quota.py`

**Interfaces:**
- Consumes: `tiers.get_tier`
- Produces: `tiers.questions_per_dashboard(key: str | None) -> int`; `plan_dashboard(goal: str, schema_hint: str = "", *, max_questions: int = 6)`

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_usage_quota.py`:

```python
from app.billing import tiers


def test_tier_quotas_match_the_costed_plan() -> None:
    assert tiers.get_tier("free").monthly_quota == 300
    assert tiers.get_tier("pro").monthly_quota == 800
    assert tiers.get_tier("max").monthly_quota == 4000
    assert tiers.get_tier("max_plus").monthly_quota == 6000


def test_free_dashboards_are_planned_smaller() -> None:
    """Half the questions, half the cost — the free tier's value comes from
    this, not from a bigger number."""
    assert tiers.questions_per_dashboard("free") == 3
    assert tiers.questions_per_dashboard("pro") == 6
    assert tiers.questions_per_dashboard(None) == 3  # unknown key falls back to free


def test_tier_copy_states_the_real_quota() -> None:
    assert any("300" in f for f in tiers.get_tier("free").features)
    assert any("800" in f for f in tiers.get_tier("pro").features)
    # Max+ is 7.5x Pro, not 10x — the old multiplier would now be a lie.
    assert not any("10x" in f for f in tiers.get_tier("max_plus").features)
```

- [ ] **Step 2: Run the test and watch it fail**

Run from `backend/`: `DIGEST_ENABLED=true python -m pytest tests/test_usage_quota.py -q`
Expected: FAIL — `assert 30 == 300`

- [ ] **Step 3: Reprice the tiers**

In `backend/app/billing/tiers.py`, update the module docstring and each tier. Add `questions_per_dashboard` to the dataclass and a helper:

```python
@dataclass(frozen=True)
class Tier:
    key: str
    name: str
    price_usd: int
    monthly_quota: int
    features: list[str] = field(default_factory=list)
    white_label: bool = False  # may set/serve custom branding on embeds
    ai_chat: bool = False  # Nexus AI assistant participates in team chat
    # Widgets an AI-generated dashboard plans for. Free gets a smaller board so
    # the same quota buys twice as many of them — and three focused widgets beat
    # six scattered ones as a first impression.
    dashboard_questions: int = 6
```

Then replace the four purchasable entries in `TIERS` (leave `unlimited` untouched):

```python
    "free": Tier(
        key="free",
        name="Free",
        price_usd=0,
        monthly_quota=300,
        features=["Aylıq 300 AI sorğusu", "İnteraktiv dashboardlar", "CSV ixrac"],
        dashboard_questions=3,
    ),
    "pro": Tier(
        key="pro",
        name="Pro",
        price_usd=20,
        monthly_quota=800,
        features=["Aylıq 800 AI sorğusu", "Proqnoz & anomaliya", "White-label brending"],
        white_label=True,
    ),
    "max": Tier(
        key="max",
        name="Max",
        price_usd=100,
        monthly_quota=4000,
        features=[
            "Aylıq 4000 AI sorğusu (5x)",
            "Bütün Pro üstünlükləri",
            "Komanda söhbətində AI köməkçi",
            "Genişləndirilmiş tarixçə",
        ],
        white_label=True,
        ai_chat=True,
    ),
    "max_plus": Tier(
        key="max_plus",
        name="Max+",
        price_usd=150,
        monthly_quota=6000,
        features=[
            "Aylıq 6000 AI sorğusu",
            "Bütün Max üstünlükləri",
            "Komanda söhbətində AI köməkçi",
            "Ən yüksək limit",
        ],
        white_label=True,
        ai_chat=True,
    ),
```

Also update the module docstring — it currently claims "The $100 plan grants 5x the $20
plan; the $150 plan grants 10x", and the second half is no longer true:

```python
"""Subscription tier catalogue — the single source of truth for quotas.

A quota unit is one model call, not one HTTP request, so a fan-out endpoint
costs what it actually spends. Numbers are set for roughly a 60% gross margin at
an estimated $0.01 per completion — an estimate that has never been measured, so
re-derive them from ai_spend_daily once real traffic exists.

Free plans smaller dashboards (3 questions rather than 6) so the same quota buys
twice as many of them.
"""
```

Add:

```python
def questions_per_dashboard(key: str | None) -> int:
    """How many questions an AI dashboard plans for this tier."""
    return get_tier(key).dashboard_questions
```

- [ ] **Step 4: Make the planner take a bound**

In `backend/app/ai/dashboard_planner.py`, replace the module constant use:

```python
_MAX_QUESTIONS = 6


async def plan_dashboard(goal: str, schema_hint: str = "", *, max_questions: int = _MAX_QUESTIONS) -> list[str]:
    """Return up to ``max_questions`` distinct NL questions covering ``goal``; [] on failure."""
```

and the final line of the `try` block:

```python
        return questions[:max_questions]
```

- [ ] **Step 5: Pass the caller's tier through**

In `backend/app/services/dashboard_service.py`, `generate_dashboard` currently calls `plan_dashboard(goal)`. Load the user's tier and pass the bound:

```python
async def generate_dashboard(
    db: AsyncSession,
    cache: CacheService,
    user_id: str,
    goal: str,
    datasource_id: str | None,
) -> Dashboard:
    """Plan questions for ``goal`` (AI), then assemble a dashboard from them."""
    from app.ai import dashboard_planner
    from app.billing import tiers
    from app.models.user import User

    tier_key = (
        await db.execute(select(User.subscription_tier).where(User.id == user_id))
    ).scalar_one_or_none()
    questions = await dashboard_planner.plan_dashboard(
        goal, max_questions=tiers.questions_per_dashboard(tier_key)
    )
    if not questions:
        raise SchemaNotFoundError("Dashboard planı yaradıla bilmədi.")
    return await assemble_dashboard(
        db, cache, user_id, goal, f"AI tərəfindən yaradıldı: {goal}", questions, datasource_id
    )
```

- [ ] **Step 6: Run the test and watch it pass**

Run from `backend/`: `DIGEST_ENABLED=true python -m pytest tests/test_usage_quota.py -q`
Expected: PASS, 9 tests

- [ ] **Step 7: Run the whole suite**

Run from `backend/`: `DIGEST_ENABLED=true python -m pytest -q`
Expected: PASS. `test_dashboard_api.py` may assert a widget count — update it to the tier's bound rather than a bare 6.

- [ ] **Step 8: Commit**

```bash
git add backend/app/billing/tiers.py backend/app/ai/dashboard_planner.py \
        backend/app/services/dashboard_service.py backend/tests/test_usage_quota.py
git commit -m "feat(billing): reprice the tiers for per-call quota, and shrink free boards"
```

---

### Task 11: Surface the budget to the operator

**Files:**
- Modify: `backend/app/core/metrics.py`
- Modify: `backend/app/core/health.py` (`_ai_status`, line 82)
- Modify: `backend/app/main.py` (startup checks)
- Modify: `.env.prod.example`, `docs/deploy.md`
- Test: `backend/tests/test_health.py`

**Interfaces:**
- Consumes: `cost.spent_today_micro`, `cost.over_ceiling`
- Produces: metrics `ai_cost_usd_total` (labels: `feature`), `ai_budget_remaining_usd`; `_ai_status()` becomes async

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_health.py`:

```python
@pytest.mark.asyncio
async def test_ready_reports_an_exhausted_budget_without_gating(
    client, monkeypatch: pytest.MonkeyPatch
) -> None:
    """An exhausted budget is a degraded AI, not an unready app — the product
    still serves from its deterministic paths."""
    from app.billing import cost
    from app.config import settings

    monkeypatch.setattr(settings, "AI_API_KEY", "k")
    monkeypatch.setattr(settings, "AI_MODEL", "gpt-4o")
    monkeypatch.setattr(settings, "AI_DAILY_USD_CEILING", 1.0)
    await cost.record("text2sql", "gpt-4o", 400_000, 40_000)
    cost.reset_cache()

    resp = await client.get("/ready")
    assert resp.status_code == 200
    assert "budget" in resp.json()["components"]["ai"]
```

- [ ] **Step 2: Run the test and watch it fail**

Run from `backend/`: `DIGEST_ENABLED=true python -m pytest tests/test_health.py -q`
Expected: FAIL — the `ai` component still reads `"ok"`

- [ ] **Step 3: Add the metrics**

Append to `backend/app/core/metrics.py`:

```python
ai_cost_usd_total = Counter(
    "nexusbi_ai_cost_usd_total",
    "AI engine spend in USD",
    ["feature"],
)
ai_budget_remaining_usd = Gauge(
    "nexusbi_ai_budget_remaining_usd",
    "USD left under today's AI spend ceiling",
)
```

and extend the import: `from prometheus_client import Counter, Gauge, Histogram`.

- [ ] **Step 4: Feed the metrics from the ledger**

In `backend/app/billing/cost.py`, inside `record`, after the successful `_note_spend(spent)`:

```python
        metrics.ai_cost_usd_total.labels(feature).inc(spent / 1_000_000)
        if settings.AI_DAILY_USD_CEILING > 0:
            remaining = settings.AI_DAILY_USD_CEILING - (await spent_today_micro()) / 1_000_000
            metrics.ai_budget_remaining_usd.set(max(0.0, remaining))
```

with `from app.core import metrics` at the top.

- [ ] **Step 5: Report it in /ready**

In `backend/app/core/health.py`, make `_ai_status` async and extend it:

```python
async def _ai_status() -> str:
    """Whether model calls are possible — reported, never gating.

    A keyless install is supported: ``ai.client._preflight`` raises before any
    network call and every caller falls through to its deterministic path. The
    same is true once the daily budget is gone, which is why both are reported
    the same way: the app is genuinely ready to serve, it just answers from the
    fallbacks. Surfacing it here is what stops that being a silent surprise.
    """
    from app.billing import cost
    from app.config import settings

    if not (settings.AI_API_KEY and settings.AI_MODEL):
        return "degraded: no API key, deterministic fallbacks only"
    if await cost.over_ceiling():
        spent = await cost.spent_today_micro() / 1_000_000
        return (
            f"degraded: daily budget exhausted (${spent:.2f} of "
            f"${settings.AI_DAILY_USD_CEILING:.2f}), deterministic fallbacks only"
        )
    return "ok"
```

and at line 120 change the call to `components["ai"] = await _ai_status()`.

- [ ] **Step 6: Warn at startup when the ceiling is unpriced**

In `backend/app/main.py`, next to the existing `_assert_production_secrets` warning:

```python
    if settings.AI_DAILY_USD_CEILING > 0 and not (
        settings.AI_PRICE_INPUT_USD_PER_1M or settings.AI_PRICE_OUTPUT_USD_PER_1M
    ):
        log.warning(
            "ai_ceiling_without_prices",
            detail=(
                "AI_DAILY_USD_CEILING is set but token prices are 0, so every call "
                "costs 0 and the ceiling can never trip. Set "
                "AI_PRICE_INPUT_USD_PER_1M and AI_PRICE_OUTPUT_USD_PER_1M."
            ),
        )
```

- [ ] **Step 7: Document the knobs**

Add to `.env.prod.example`:

```bash
# AI spend control. Prices are USD per 1M tokens from the engine's pricing page
# (gpt-4o was 2.50 / 10.00 on 2026-07-30). Leaving them at 0 makes every call
# cost 0, which silently disables the ceiling.
AI_PRICE_INPUT_USD_PER_1M=2.50
AI_PRICE_OUTPUT_USD_PER_1M=10.00
AI_PRICE_EMBEDDING_USD_PER_1M=0.02
AI_DAILY_USD_CEILING=10.0
```

and a short "AI xərc nəzarəti" section in `docs/deploy.md` describing what happens at the ceiling (deterministic fallbacks, visible in `/ready`) and that it clears at UTC midnight.

- [ ] **Step 8: Run the tests and watch them pass**

Run from `backend/`: `DIGEST_ENABLED=true python -m pytest tests/test_health.py tests/test_ai_cost.py -q`
Expected: PASS

- [ ] **Step 9: Run the whole suite and the lint gate**

Run from `backend/`: `DIGEST_ENABLED=true python -m pytest -q && ruff check --select F app`
Expected: PASS, no findings

- [ ] **Step 10: Commit**

```bash
git add backend/app/core/metrics.py backend/app/core/health.py backend/app/main.py \
        backend/app/billing/cost.py .env.prod.example docs/deploy.md backend/tests/test_health.py
git commit -m "feat(cost): show the operator what today cost and what is left"
```

---

## Post-merge obligation

Recorded in the spec and in memory, not optional: **about a week after this ships, read
the real cost per call out of `ai_spend_daily` and re-set the tier numbers.** Every figure
in Task 10 derives from an estimated $0.01 per completion that has never been measured. At
the chosen ~60% margin there is little room for that estimate to be wrong — if the true
figure is $0.03, the Max tier costs $120 on a $100 plan. Until that measurement exists,
`AI_DAILY_USD_CEILING` is the only thing bounding the damage.

Query to run:

```sql
SELECT feature,
       SUM(calls) AS calls,
       SUM(micro_usd) / 1000000.0 AS usd,
       SUM(micro_usd) / NULLIF(SUM(calls), 0) AS micro_usd_per_call
FROM ai_spend_daily
GROUP BY feature
ORDER BY usd DESC;
```
