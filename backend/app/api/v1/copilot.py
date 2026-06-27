"""Agentic copilot endpoint."""
from __future__ import annotations

from fastapi import APIRouter

from app.ai import copilot
from app.dependencies import CacheDep, DbDep, RateLimitedUser
from app.schemas.copilot import CopilotRequest, CopilotResponse

router = APIRouter(prefix="/copilot", tags=["copilot"])


@router.post("/chat", response_model=CopilotResponse)
async def chat(
    payload: CopilotRequest, user: RateLimitedUser, db: DbDep, cache: CacheDep
) -> CopilotResponse:
    """One copilot turn: the model may run queries and build dashboards via tools.

    Rate-limited (one quota unit per turn); the internal tool-calling loop is
    hard-capped by COPILOT_MAX_STEPS so a turn always terminates.
    """
    result = await copilot.run(
        payload.message,
        [t.model_dump() for t in payload.history],
        db,
        cache,
        user.id,
    )
    return CopilotResponse.from_result(result)
