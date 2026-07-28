"""BA Framework Studio endpoints (SWOT / Porter / BCG / BPMN)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Response, status

from app.core.rate_limit import rate_limit
from app.dependencies import CacheDep, CurrentUser, DbDep, RateLimitedUser
from app.schemas.ba import (
    BAArtifactResponse,
    BAGenerateRequest,
    BAPromoteRequest,
    BAPromoteResponse,
)
from app.schemas.decision import DecisionResponse
from app.services import ba_service as svc

router = APIRouter(prefix="/ba", tags=["ba-studio"])

# Generation is the heaviest path in the feature — an AI call plus a profiling read
# and up to three guarded queries — so the monthly AI counter (RateLimitedUser) is
# backed by a per-IP burst limit, as on the other heavy endpoints.
_generate_limit = rate_limit("ba_generate", limit=10, window_seconds=60)
# Promoting captures a Decision baseline, which can run a metric query.
_promote_limit = rate_limit("ba_promote", limit=20, window_seconds=60)


@router.post(
    "/generate",
    response_model=BAArtifactResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(_generate_limit)],
)
async def generate(
    payload: BAGenerateRequest, user: RateLimitedUser, db: DbDep, cache: CacheDep
) -> BAArtifactResponse:
    """Generate a framework artifact (AI + deterministic fallback) and save it."""
    artifact = await svc.generate(
        db, cache, user.id, payload.framework, payload.title,
        payload.context, payload.datasource_id,
    )
    return svc.to_response(artifact)


@router.get("", response_model=list[BAArtifactResponse])
async def list_artifacts(user: CurrentUser, db: DbDep) -> list[BAArtifactResponse]:
    return [svc.to_response(a) for a in await svc.list_for_user(db, user.id)]


@router.get("/{artifact_id}", response_model=BAArtifactResponse)
async def get_artifact(artifact_id: str, user: CurrentUser, db: DbDep) -> BAArtifactResponse:
    return svc.to_response(await svc.get(db, user.id, artifact_id))


@router.post(
    "/{artifact_id}/promote",
    response_model=BAPromoteResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(_promote_limit)],
)
async def promote_action(
    artifact_id: str,
    payload: BAPromoteRequest,
    user: RateLimitedUser,
    db: DbDep,
    cache: CacheDep,
) -> BAPromoteResponse:
    """Turn one prioritised action into a tracked Decision (idempotent per action).

    Uses the AI quota (unlike ``POST /decisions/``): the metric query is always set
    here, so capturing the baseline runs a full NL→SQL pass rather than reusing an
    existing query log.
    """
    decision, artifact = await svc.promote(db, cache, user.id, artifact_id, payload.action_index)
    return BAPromoteResponse(
        decision=DecisionResponse.model_validate(decision),
        artifact=svc.to_response(artifact),
    )


@router.delete("/{artifact_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_artifact(artifact_id: str, user: CurrentUser, db: DbDep) -> Response:
    await svc.delete(db, user.id, artifact_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
