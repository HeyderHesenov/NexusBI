"""AI quality & observability endpoints: eval runs, RAG reindex, AI call stats."""
from __future__ import annotations

from fastapi import APIRouter
from sqlalchemy import select

from app.ai import client, retrieval
from app.ai.eval import regression, runner
from app.dependencies import CurrentUser, DbDep, RateLimitedUser
from app.models.eval_run import EvalRun
from app.schemas.ai_quality import EvalRunResponse, ObservabilitySummary, ReindexResult

router = APIRouter(prefix="/ai", tags=["ai-quality"])


# Eval + reindex drive real AI work (generations / embeddings), so they consume
# the AI quota like every other AI-heavy endpoint — bounding abuse + cost.
@router.post("/eval/run", response_model=EvalRunResponse)
async def run_eval(user: RateLimitedUser, db: DbDep, grounded: bool = False) -> EvalRunResponse:
    # grounded=True measures the shipped pipeline (engine + metric context + RAG)
    # against this user's corpus; bare (default) measures the engine alone.
    run = await runner.run_eval(db, grounded=grounded, user_id=user.id)
    await runner.maybe_alert(db, user.id, run)
    return EvalRunResponse.model_validate(run)


@router.post("/eval/history-regression", response_model=EvalRunResponse)
async def history_regression(user: RateLimitedUser, db: DbDep) -> EvalRunResponse:
    # Re-checks the user's OWN trusted (saved / dashboard) questions for AI drift.
    run = await regression.run_history_regression(db, user.id)
    await runner.maybe_alert(db, user.id, run)
    return EvalRunResponse.model_validate(run)


@router.get("/eval/runs", response_model=list[EvalRunResponse])
async def list_runs(user: CurrentUser, db: DbDep) -> list[EvalRunResponse]:
    rows = (
        await db.execute(select(EvalRun).order_by(EvalRun.created_at.desc()).limit(50))
    ).scalars().all()
    return [EvalRunResponse.model_validate(r) for r in rows]


@router.get("/observability", response_model=ObservabilitySummary)
async def observability(user: CurrentUser) -> ObservabilitySummary:
    return ObservabilitySummary.model_validate(client.observability())


@router.post("/retrieval/reindex", response_model=ReindexResult)
async def reindex(user: RateLimitedUser, db: DbDep) -> ReindexResult:
    return ReindexResult(indexed=await retrieval.reindex(db, user.id))
