"""Text2SQL eval runner: execution-match scoring + persistence."""
from __future__ import annotations

from httpx import AsyncClient

from app.ai.eval import runner
from app.ai.eval.golden import GOLDEN_SET
from app.ai.types import Text2SQLResult
from app.db.session import AsyncSessionLocal


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


async def test_run_eval_counts_a_miss():
    async def gen(nl, schema, dialect, ctx):
        # Always return the same (wrong for most) SQL → not a perfect match.
        return Text2SQLResult(sql="SELECT COUNT(*) AS count FROM products",
                              explanation="", confidence=0.5, warnings=[])

    async with AsyncSessionLocal() as db:
        run = await runner.run_eval(db, generate=gen)
        await db.commit()
    assert run.passed < run.total  # at least one golden case is not satisfied


async def test_ai_quality_endpoints(client: AsyncClient, auth: dict):
    run = await client.post("/api/v1/ai/eval/run", headers=auth)
    assert run.status_code == 200, run.text
    assert run.json()["total"] == len(GOLDEN_SET)

    runs = await client.get("/api/v1/ai/eval/runs", headers=auth)
    assert runs.status_code == 200
    assert len(runs.json()) >= 1

    obs = await client.get("/api/v1/ai/observability", headers=auth)
    assert obs.status_code == 200
    assert "calls" in obs.json()

    reindex = await client.post("/api/v1/ai/retrieval/reindex", headers=auth)
    assert reindex.status_code == 200
    assert "indexed" in reindex.json()
