"""History regression: does the engine still answer the user's OWN trusted questions
the same way? Re-generates SQL for queries the user saved or put on a dashboard and
compares the NEW result to the STORED SQL's result on the CURRENT data — so data
changes cancel out and only genuine AI drift (the model now generating a
different/worse query for the same question) is flagged.

Scoped to demo queries (datasource_id is None) for now: safe, sandboxed execution,
and that's where a demo user's real logged questions live. Live datasources are a
documented follow-up (needs the guarded live executor on the regenerated SQL).
"""
from __future__ import annotations

import asyncio

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.eval.runner import _denotation, _strict_key
from app.config import settings
from app.core import metrics
from app.core.logging import get_logger
from app.db import demo_data
from app.models.eval_run import EvalRun

_log = get_logger("nexusbi.eval.regression")
_MAX_ITEMS = 25


async def _trusted_log_ids(db: AsyncSession, user_id: str) -> list[str]:
    """QueryLog ids the user explicitly kept: saved queries + dashboard widgets."""
    from app.models.dashboard import Dashboard, Widget
    from app.models.saved_query import SavedQuery

    saved = (
        await db.execute(
            select(SavedQuery.last_query_log_id).where(
                SavedQuery.user_id == user_id, SavedQuery.last_query_log_id.is_not(None)
            )
        )
    ).scalars().all()
    widgets = (
        await db.execute(
            select(Widget.query_log_id)
            .join(Dashboard, Widget.dashboard_id == Dashboard.id)
            .where(Dashboard.user_id == user_id, Widget.query_log_id.is_not(None))
        )
    ).scalars().all()
    seen: list[str] = []
    for lid in [*saved, *widgets]:
        if lid and lid not in seen:
            seen.append(lid)
    return seen


def _item(nl: str, *, passed: bool, strict: bool = False, skipped: bool = False) -> dict:
    return {"nl": nl, "passed": passed, "strict_passed": strict, "latency_ms": 0,
            "tier": "history", "skipped": skipped}


async def _check_drift(nl: str, stored_sql: str, user_id: str) -> dict:
    """One item: regenerate from NL, then compare the new SQL to the stored SQL on
    the SAME data snapshot (so the live-demo feed can't fake drift). Own session for
    the concurrent gather. A baseline that no longer runs is SKIPPED (not the model's
    fault); a regeneration/run failure counts as drift.
    """
    from app.ai import retrieval
    from app.db.session import AsyncSessionLocal
    from app.services import metric_service
    from app.services.query_service import _engine

    try:
        async with AsyncSessionLocal() as db:
            extra = metric_service.metrics_as_prompt(
                await metric_service.list_for(db, user_id, None)
            )
            rag = await retrieval.retrieve_context(db, nl, user_id, None)
        if rag:
            extra = f"{extra}\n\n{rag}" if extra else rag
        new = await _engine.generate_sql(nl, demo_data.format_demo_schema(), "sqlite", extra)
    except Exception as exc:  # noqa: BLE001 — model couldn't reproduce a query = drift
        _log.info("regression_regen_failed", nl=nl[:80], error=str(exc)[:160])
        return _item(nl, passed=False)

    # Both SQLs run on ONE seeded snapshot (off-thread so 25 sync seeds don't block
    # the event loop). Order: [stored, new].
    baseline, new_rows = await asyncio.to_thread(
        demo_data.execute_demo_snapshot, [stored_sql, new.sql]
    )
    if baseline is None:
        return _item(nl, passed=True, skipped=True)  # stored SQL no longer runs → exclude
    if new_rows is None:
        return _item(nl, passed=False)  # new SQL invalid → drift
    passed = _denotation(new_rows) == _denotation(baseline)
    strict = passed and _strict_key(new_rows) == _strict_key(baseline)
    return _item(nl, passed=passed, strict=strict)


async def run_history_regression(db: AsyncSession, user_id: str) -> EvalRun:
    """Re-check the user's trusted demo queries for AI drift; persist as an EvalRun."""
    from app.models.query_log import QueryLog

    ids = await _trusted_log_ids(db, user_id)
    logs = []
    if ids:
        logs = (
            await db.execute(
                select(QueryLog)
                .where(
                    QueryLog.id.in_(ids[:_MAX_ITEMS]),
                    QueryLog.datasource_id.is_(None),  # demo-scoped for now
                    QueryLog.generated_sql != "",
                )
                .order_by(QueryLog.created_at.desc())
            )
        ).scalars().all()

    raw = list(
        await asyncio.gather(
            *(_check_drift(log.natural_language, log.generated_sql, user_id) for log in logs)
        )
    )
    skipped = sum(1 for d in raw if d["skipped"])
    # Items whose STORED SQL no longer runs aren't AI drift — exclude from scoring.
    details = [{k: v for k, v in d.items() if k != "skipped"} for d in raw if not d["skipped"]]
    total = len(details)
    passed = sum(1 for d in details if d["passed"])
    stability = passed / total if total else 1.0
    note = f"{total - passed} drift / {total} etibarlı sorğu"
    if skipped:
        note += f" · {skipped} keçildi (köhnə SQL)"

    run = EvalRun(
        model="ai-engine" if settings.AI_MODEL else "rule_based",
        mode="history",
        total=total,
        passed=passed,
        exec_accuracy=round(stability, 4),
        avg_latency_ms=0.0,
        notes=note,
        details=details,
    )
    db.add(run)
    await db.flush()
    await db.refresh(run)
    metrics.text2sql_eval_accuracy.set(stability)
    return run
