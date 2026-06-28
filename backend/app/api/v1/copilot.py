"""Agentic copilot endpoint."""
from __future__ import annotations

from fastapi import APIRouter

from app.ai import copilot
from app.billing import usage_service
from app.dependencies import CacheDep, CurrentUser, DbDep
from app.schemas.copilot import CopilotRequest, CopilotResponse

router = APIRouter(prefix="/copilot", tags=["copilot"])


@router.post("/chat", response_model=CopilotResponse)
async def chat(
    payload: CopilotRequest, user: CurrentUser, db: DbDep, cache: CacheDep
) -> CopilotResponse:
    """One copilot turn.

    - mode="plan": propose the steps it would take (no execution) for the user to
      approve — nothing is created, so it does NOT consume AI quota.
    - mode="execute" (default): run the bounded tool-calling loop (consumes one
      quota unit); the model may run queries, build/share dashboards, save
      queries, define metrics, etc. The loop is hard-capped by COPILOT_MAX_STEPS.
    """
    history = [t.model_dump() for t in payload.history]
    if payload.mode == "plan":
        return CopilotResponse.from_result(await copilot.plan(payload.message, history))
    # Execute consumes quota and runs the tools.
    await usage_service.check_and_consume(db, user)
    plan = [s.model_dump() for s in payload.plan] or None
    result = await copilot.run(payload.message, history, db, cache, user.id, plan)
    return CopilotResponse.from_result(result)
