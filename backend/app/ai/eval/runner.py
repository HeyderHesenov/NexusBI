"""Run the golden set through the Text2SQL engine and score execution accuracy."""
from __future__ import annotations

import asyncio
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


def _denotation(rows: list[dict]) -> list[tuple]:
    """Value-based (column-name-agnostic) form — standard Text2SQL execution accuracy.

    Each row becomes a sorted multiset of its VALUES (the column alias the model chose
    is irrelevant: `SUM(x) AS total` and `AS total_revenue` denote the same answer).

    LIMITATION: sorting values within a row means two SAME-TYPED projected columns can
    swap and still match (e.g. `MIN(price), MAX(price)` vs `MAX, MIN`). The current
    golden set is immune — every multi-column case is exactly one text label + one
    number, which `_norm` prefixes 's'/'n' so they can't collide. Keep golden cases to
    that shape, or this check would need column-aware matching.
    """
    return sorted(tuple(sorted(_norm(v) for v in row.values())) for row in rows)


def _strict_key(rows: list[dict]) -> list[tuple]:
    """Column-name-aware form — kept as a secondary, stricter signal for transparency."""
    return sorted(tuple(sorted((str(k), _norm(v)) for k, v in row.items())) for row in rows)


async def _default_generate(nl: str, schema: str, dialect: str, ctx: str) -> Text2SQLResult:
    from app.services.query_service import _engine

    return await _engine.generate_sql(nl, schema, dialect, ctx)


async def rule_based_generate(nl: str, schema: str, dialect: str, ctx: str) -> Text2SQLResult:
    """Deterministic, keyless generator — powers the CI regression gate (no LLM)."""
    from app.ai import rule_based_sql

    return rule_based_sql.generate_sql_fallback(nl)


def _grounded_generate(user_id: str) -> GenerateFn:
    """A generator that grounds the engine with the SHIPPED pipeline's context —
    the user's metric catalog + RAG-retrieved similar prior queries. The only
    difference from bare generation, so the bare→grounded delta isolates RAG's value.

    Each call opens its OWN session: cases run concurrently (asyncio.gather) and an
    AsyncSession is not safe for concurrent use, so a shared session would error.
    """
    async def gen(nl: str, schema: str, dialect: str, _ctx: str) -> Text2SQLResult:
        from app.ai import retrieval
        from app.db.session import AsyncSessionLocal
        from app.services import metric_service
        from app.services.query_service import _engine

        async with AsyncSessionLocal() as db:
            extra = metric_service.metrics_as_prompt(
                await metric_service.list_for(db, user_id, None)
            )
            rag = await retrieval.retrieve_context(db, nl, user_id, None)
        if rag:
            extra = f"{extra}\n\n{rag}" if extra else rag
        return await _engine.generate_sql(nl, schema, dialect, extra)

    return gen


async def evaluate_case(case: GoldenCase, generate: GenerateFn, schema_text: str) -> dict:
    """Return {nl, passed, strict_passed} for one case.

    ``passed`` is value-based execution match (the headline metric); ``strict_passed``
    additionally requires identical column names. Measures the bare Text2SQL engine
    (no RAG context) on purpose — a deterministic, corpus-independent CI signal; RAG
    grounding is exercised separately by the live pipeline + retrieval tests.
    """
    started = time.perf_counter()
    try:
        candidate = await generate(case.nl_query, schema_text, "sqlite", "")
        _cc, cand_rows = demo_data.execute_demo_sql(candidate.sql)
        # A question can have several CORRECT gold forms (e.g. with/without an id
        # column); pass on a value-match against ANY of them.
        exp_rows_by_gold = [demo_data.execute_demo_sql(sql)[1] for sql in case.expected_sqls]
    except Exception as exc:  # noqa: BLE001 — a failure to generate/run is a miss
        _log.info("eval_case_failed", nl=case.nl_query, error=str(exc)[:160])
        latency_ms = int((time.perf_counter() - started) * 1000)
        return {"nl": case.nl_query, "passed": False, "strict_passed": False,
                "latency_ms": latency_ms, "tier": case.tier}
    cand_d = _denotation(cand_rows)
    passed = any(cand_d == _denotation(rows) for rows in exp_rows_by_gold)
    # strict (column-name-aware) is measured only against the primary gold.
    strict = passed and _strict_key(cand_rows) == _strict_key(exp_rows_by_gold[0])
    latency_ms = int((time.perf_counter() - started) * 1000)
    return {"nl": case.nl_query, "passed": passed, "strict_passed": strict,
            "latency_ms": latency_ms, "tier": case.tier}


async def maybe_alert(db: AsyncSession, user_id: str, run: EvalRun) -> bool:
    """Raise an in-app notification when a run's accuracy falls below the alert
    threshold — turns the quality system from "viewable" into "tells you". Reuses
    the existing Notification + workflow dispatch (mock-first)."""
    if run.exec_accuracy >= settings.EVAL_ALERT_THRESHOLD:
        return False
    from sqlalchemy import select

    from app.core.notification_types import NotificationCategory
    from app.models.alert import Notification
    from app.services import integration_service

    # Dedup: don't spam a fresh alert (or re-dispatch webhooks) while an earlier
    # AI-quality alert for this user is still unread.
    existing = await db.execute(
        select(Notification.id).where(
            Notification.user_id == user_id,
            Notification.read.is_(False),
            Notification.category == NotificationCategory.AI_QUALITY,
        ).limit(1)
    )
    if existing.scalar_one_or_none() is not None:
        return False

    pct = round(run.exec_accuracy * 100)
    if run.mode == "history":
        title = "⚠️ AI drift aşkarlandı"
        body = f"{run.total - run.passed}/{run.total} etibarlı sorğu fərqli nəticə verir (stabillik {pct}%)."
    else:
        floor = round(settings.EVAL_ALERT_THRESHOLD * 100)
        title = "⚠️ AI keyfiyyəti düşdü"
        body = f"{run.mode} eval dəqiqliyi {pct}% — həddən ({floor}%) aşağı."
    db.add(Notification(
        user_id=user_id, title=title, body=body,
        category=NotificationCategory.AI_QUALITY,
    ))
    await db.flush()
    await integration_service.dispatch(db, user_id, title, body)
    return True


async def run_eval(
    db: AsyncSession,
    *,
    generate: GenerateFn | None = None,
    grounded: bool = False,
    user_id: str | None = None,
) -> EvalRun:
    """Score the golden set, persist + gauge the result, return the EvalRun.

    ``grounded=True`` measures the shipped pipeline (engine + metric context + RAG)
    instead of the bare engine; the bare→grounded accuracy delta quantifies RAG's value.
    """
    if generate is None:
        generate = _grounded_generate(user_id or "") if grounded else _default_generate
    schema_text = demo_data.format_demo_schema()
    # Cases are independent — run them concurrently so a 20-case set stays snappy
    # (wall-clock ≈ one generation, not the sum).
    details = list(
        await asyncio.gather(*(evaluate_case(c, generate, schema_text) for c in GOLDEN_SET))
    )

    total = len(GOLDEN_SET)
    passed = sum(1 for d in details if d["passed"])
    strict = sum(1 for d in details if d["strict_passed"])
    accuracy = passed / total if total else 0.0
    # True mean of per-case latency (gather makes wall-clock meaningless for this).
    avg_latency = sum(d["latency_ms"] for d in details) / total if total else 0.0

    run = EvalRun(
        model=settings.AI_MODEL or "rule_based",
        mode="grounded" if grounded else "bare",
        total=total,
        passed=passed,
        exec_accuracy=round(accuracy, 4),
        avg_latency_ms=round(avg_latency, 1),
        notes=f"strict {strict}/{total}" + (
            " · below threshold" if accuracy < settings.EVAL_MIN_ACCURACY else ""
        ),
        details=details,
    )
    db.add(run)
    await db.flush()
    await db.refresh(run)
    metrics.text2sql_eval_accuracy.set(accuracy)
    return run
