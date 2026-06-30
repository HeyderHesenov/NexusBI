"""Text2SQL eval runner: value-based execution-match scoring + persistence."""
from __future__ import annotations

import pytest
from httpx import AsyncClient

from app.ai.eval import runner
from app.ai.eval.golden import GOLDEN_SET
from app.ai.types import Text2SQLResult
from app.db.session import AsyncSessionLocal
from app.services import query_service


def _perfect_gen():
    expected = {c.nl_query: c.expected_sql for c in GOLDEN_SET}

    async def gen(nl, schema, dialect, ctx):
        return Text2SQLResult(sql=expected[nl], explanation="", confidence=1.0, warnings=[])

    return gen


async def test_run_eval_perfect_engine():
    async with AsyncSessionLocal() as db:
        run = await runner.run_eval(db, generate=_perfect_gen())
        await db.commit()
    assert run.total == len(GOLDEN_SET)
    assert run.passed == run.total
    assert run.exec_accuracy == 1.0
    assert len(run.details) == run.total
    assert all(d["passed"] for d in run.details)


def test_all_golds_execute():
    """Every authored gold SQL (primary + alts) must run on the demo schema."""
    from app.db import demo_data

    for case in GOLDEN_SET:
        for sql in case.expected_sqls:
            demo_data.execute_demo_sql(sql)  # raises if a gold is malformed


def test_golden_covers_all_tiers():
    """The set must span easy/medium/hard so accuracy can be reported per difficulty."""
    tiers = {c.tier for c in GOLDEN_SET}
    assert tiers == {"easy", "medium", "hard"}
    for t in ("easy", "medium", "hard"):
        assert sum(1 for c in GOLDEN_SET if c.tier == t) >= 3


async def test_run_eval_details_carry_tier():
    async with AsyncSessionLocal() as db:
        run = await runner.run_eval(db, generate=_perfect_gen())
        await db.commit()
    assert {d["tier"] for d in run.details} == {"easy", "medium", "hard"}


async def test_run_eval_grounded_mode(monkeypatch):
    """Grounded mode builds the metric+RAG context and routes it through the engine."""
    from app.ai import retrieval

    seen = {"rag": False}
    expected = {c.nl_query: c.expected_sql for c in GOLDEN_SET}

    async def fake_retrieve(db, nl, user_id, ds_id):
        seen["rag"] = True  # the grounded path must consult RAG retrieval
        return "BƏNZƏR: ..."

    async def fake_sql(self, nl, schema, dtype="sqlite", extra_context=""):
        return Text2SQLResult(sql=expected[nl], explanation="", confidence=1.0, warnings=[])

    monkeypatch.setattr(retrieval, "retrieve_context", fake_retrieve)
    monkeypatch.setattr(query_service.Text2SQLEngine, "generate_sql", fake_sql)

    async with AsyncSessionLocal() as db:
        run = await runner.run_eval(db, grounded=True, user_id="u1")  # no explicit generate
        await db.commit()
    assert run.mode == "grounded"
    assert seen["rag"] is True  # grounded path actually invoked RAG retrieval
    assert run.passed == run.total


async def test_bare_mode_default():
    async with AsyncSessionLocal() as db:
        run = await runner.run_eval(db, generate=_perfect_gen())
        await db.commit()
    assert run.mode == "bare"


# ─── A: CI regression gate (deterministic, keyless) ───

async def test_rule_based_eval_floor():
    """The deterministic rule-based engine must stay at/above the CI floor."""
    from app.config import settings

    async with AsyncSessionLocal() as db:
        run = await runner.run_eval(db, generate=runner.rule_based_generate)
        await db.commit()
    assert run.exec_accuracy >= settings.EVAL_RULE_BASED_FLOOR, (
        f"rule-based accuracy {run.exec_accuracy} fell below floor {settings.EVAL_RULE_BASED_FLOOR}"
    )


def test_golden_set_health():
    """No degenerate empty-set gold (rewards returning nothing); tiers covered."""
    from app.db import demo_data

    for case in GOLDEN_SET:
        _c, rows = demo_data.execute_demo_sql(case.expected_sql)
        assert len(rows) >= 1, f"primary gold returns no rows: {case.nl_query}"
    assert {c.tier for c in GOLDEN_SET} == {"easy", "medium", "hard"}


# ─── B: history regression (real user questions) ───

async def _seed_trusted_query(db, user_id: str, nl: str, sql: str) -> str:
    from app.models.query_log import QueryLog
    from app.models.saved_query import SavedQuery

    log = QueryLog(user_id=user_id, datasource_id=None, natural_language=nl, generated_sql=sql,
                   chart_type="bar", result_data={"columns": [], "rows": []})
    db.add(log)
    await db.flush()
    db.add(SavedQuery(user_id=user_id, name=nl, nl_query=nl, datasource_id=None,
                      schedule="off", last_query_log_id=log.id))
    await db.flush()
    return log.id


async def test_history_regression_no_drift(monkeypatch):
    from app.ai.eval import regression
    from app.services import query_service

    sql = "SELECT SUM(revenue) AS total_revenue FROM sales"

    async def same_sql(self, nl, schema, dtype="sqlite", extra_context=""):
        return Text2SQLResult(sql=sql, explanation="", confidence=1.0, warnings=[])

    monkeypatch.setattr(query_service.Text2SQLEngine, "generate_sql", same_sql)

    async with AsyncSessionLocal() as db:
        await _seed_trusted_query(db, "hist1", "ümumi gəlir", sql)
        await db.commit()
        run = await regression.run_history_regression(db, "hist1")
        await db.commit()
    assert run.mode == "history"
    assert run.total == 1
    assert run.passed == 1  # engine reproduces the same SQL → no drift


async def test_history_regression_detects_drift(monkeypatch):
    from app.ai.eval import regression
    from app.services import query_service

    async def different_sql(self, nl, schema, dtype="sqlite", extra_context=""):
        return Text2SQLResult(sql="SELECT COUNT(*) AS count FROM sales",
                              explanation="", confidence=1.0, warnings=[])

    monkeypatch.setattr(query_service.Text2SQLEngine, "generate_sql", different_sql)

    async with AsyncSessionLocal() as db:
        await _seed_trusted_query(db, "hist2", "ümumi gəlir",
                                  "SELECT SUM(revenue) AS total_revenue FROM sales")
        await db.commit()
        run = await regression.run_history_regression(db, "hist2")
        await db.commit()
    assert run.total == 1
    assert run.passed == 0  # engine now returns a different result → drift


async def test_history_regression_empty_history():
    from app.ai.eval import regression

    async with AsyncSessionLocal() as db:
        run = await regression.run_history_regression(db, "nobody")
        await db.commit()
    assert run.total == 0  # graceful: no trusted queries


# ─── C: alert on accuracy drop ───

async def test_eval_alert_fires_below_threshold():
    from sqlalchemy import func, select

    from app.models.alert import Notification
    from app.models.eval_run import EvalRun

    async with AsyncSessionLocal() as db:
        low = EvalRun(model="m", mode="bare", total=10, passed=3, exec_accuracy=0.3, details=[])
        fired = await runner.maybe_alert(db, "alertu", low)
        high = EvalRun(model="m", mode="bare", total=10, passed=10, exec_accuracy=1.0, details=[])
        not_fired = await runner.maybe_alert(db, "alertu", high)
        await db.commit()
        n = (
            await db.execute(
                select(func.count()).select_from(Notification).where(Notification.user_id == "alertu")
            )
        ).scalar()
    assert fired is True and not_fired is False
    assert n == 1


async def test_multi_gold_accepts_alternative_form():
    """A correct-but-alternative gold form (here: top-1 row instead of MAX()) passes."""
    case = next(c for c in GOLDEN_SET if c.nl_query.startswith("ən yüksək tək satış"))
    assert len(case.expected_sqls) >= 2  # has an accepted alternative

    async def gen(nl, schema, dialect, ctx):
        return Text2SQLResult(
            sql="SELECT revenue FROM sales ORDER BY revenue DESC LIMIT 1",
            explanation="", confidence=1.0, warnings=[],
        )

    result = await runner.evaluate_case(case, gen, "")
    assert result["passed"] is True  # matches the alt gold, not the primary MAX()


async def test_value_match_ignores_column_alias():
    """An equivalent query with a different alias must still pass (value match),
    while strict (column-name) match flags the alias difference."""
    async def gen(nl, schema, dialect, ctx):
        # Right number, different alias than the golden 'total_revenue'.
        return Text2SQLResult(
            sql="SELECT SUM(revenue) AS total FROM sales", explanation="", confidence=1.0, warnings=[],
        )

    schema = ""
    result = await runner.evaluate_case(
        next(c for c in GOLDEN_SET if c.nl_query == "ümumi gəlir"), gen, schema
    )
    assert result["passed"] is True       # value-based match succeeds
    assert result["strict_passed"] is False  # column name differs


async def test_run_eval_counts_a_miss():
    async def gen(nl, schema, dialect, ctx):
        return Text2SQLResult(sql="SELECT COUNT(*) AS count FROM products",
                              explanation="", confidence=0.5, warnings=[])

    async with AsyncSessionLocal() as db:
        run = await runner.run_eval(db, generate=gen)
        await db.commit()
    assert run.passed < run.total  # one fixed query can't satisfy every golden case


async def test_ai_quality_endpoints(client: AsyncClient, auth: dict, monkeypatch):
    # Patch the engine class so the eval endpoint (which uses the real engine) is
    # fast + hermetic — no network, deterministic.
    async def fake_sql(self, nl, schema, dtype="sqlite", extra_context=""):
        return Text2SQLResult(
            sql="SELECT SUM(revenue) AS total_revenue FROM sales",
            explanation="", confidence=0.9, warnings=[],
        )

    monkeypatch.setattr(query_service.Text2SQLEngine, "generate_sql", fake_sql)

    run = await client.post("/api/v1/ai/eval/run", headers=auth)
    assert run.status_code == 200, run.text
    body = run.json()
    assert body["total"] == len(GOLDEN_SET)
    assert len(body["details"]) == len(GOLDEN_SET)

    runs = await client.get("/api/v1/ai/eval/runs", headers=auth)
    assert runs.status_code == 200
    assert len(runs.json()) >= 1

    obs = await client.get("/api/v1/ai/observability", headers=auth)
    assert obs.status_code == 200
    assert "calls" in obs.json()

    reindex = await client.post("/api/v1/ai/retrieval/reindex", headers=auth)
    assert reindex.status_code == 200
    assert "indexed" in reindex.json()
