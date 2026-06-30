"""Run the golden set through the Text2SQL engine and score execution accuracy."""
from __future__ import annotations

import time
from typing import Awaitable, Callable

from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.eval.golden import GOLDEN_SET, GoldenCase
from app.ai.types import Text2SQLResult
from app.config import settings
from app.core import metrics
from app.core.logging import get_logger
from app.db import demo_data
from app.models.eval_run import EvalRun

_log = get_logger("nexusbi.eval")

# A generator: (nl_query, schema_text, dialect, extra_context) -> Text2SQLResult.
GenerateFn = Callable[[str, str, str, str], Awaitable[Text2SQLResult]]


def _norm(v: object) -> str:
    """Canonicalise a cell so 100 and 100.0 compare equal, but bool stays distinct."""
    if isinstance(v, bool):
        return f"b{v}"
    if isinstance(v, (int, float)):
        return f"n{round(float(v), 6)}"
    return f"s{v}"


def _result_key(rows: list[dict]) -> list[tuple]:
    """Order-insensitive, type-tolerant comparable form of a result set."""
    return sorted(tuple(sorted((str(k), _norm(v)) for k, v in row.items())) for row in rows)


async def _default_generate(nl: str, schema: str, dialect: str, ctx: str) -> Text2SQLResult:
    from app.services.query_service import _engine

    return await _engine.generate_sql(nl, schema, dialect, ctx)


async def evaluate_case(case: GoldenCase, generate: GenerateFn, schema_text: str) -> bool:
    """True when the engine's SQL returns the same rows as the expected SQL.

    Measures the bare Text2SQL engine (no RAG context) on purpose — a deterministic,
    corpus-independent regression signal suitable for CI. RAG grounding is exercised
    separately by the live pipeline + retrieval tests.
    """
    try:
        candidate = await generate(case.nl_query, schema_text, "sqlite", "")
        _cc, cand_rows = demo_data.execute_demo_sql(candidate.sql)
        _ec, exp_rows = demo_data.execute_demo_sql(case.expected_sql)
    except Exception as exc:  # noqa: BLE001 — a failure to generate/run is a miss
        _log.info("eval_case_failed", nl=case.nl_query, error=str(exc)[:160])
        return False
    return _result_key(cand_rows) == _result_key(exp_rows)


async def run_eval(db: AsyncSession, *, generate: GenerateFn | None = None) -> EvalRun:
    """Score the golden set, persist + gauge the result, return the EvalRun."""
    generate = generate or _default_generate
    schema_text = demo_data.format_demo_schema()
    started = time.perf_counter()
    passed = 0
    for case in GOLDEN_SET:
        if await evaluate_case(case, generate, schema_text):
            passed += 1
    total = len(GOLDEN_SET)
    accuracy = passed / total if total else 0.0
    avg_latency = (time.perf_counter() - started) / total * 1000 if total else 0.0

    run = EvalRun(
        model=settings.OPENAI_MODEL or "rule_based",
        total=total,
        passed=passed,
        exec_accuracy=round(accuracy, 4),
        avg_latency_ms=round(avg_latency, 1),
        notes="below threshold" if accuracy < settings.EVAL_MIN_ACCURACY else "",
    )
    db.add(run)
    await db.flush()
    await db.refresh(run)
    metrics.text2sql_eval_accuracy.set(accuracy)
    return run
