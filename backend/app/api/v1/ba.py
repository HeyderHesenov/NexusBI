"""BA Framework Studio endpoints (SWOT / Porter / BCG / BPMN)."""
from __future__ import annotations

from fastapi import APIRouter, Response, status

from app.dependencies import CurrentUser, DbDep, RateLimitedUser
from app.schemas.ba import BAArtifactResponse, BAGenerateRequest
from app.services import ba_service as svc

router = APIRouter(prefix="/ba", tags=["ba-studio"])


@router.post("/generate", response_model=BAArtifactResponse, status_code=status.HTTP_201_CREATED)
async def generate(
    payload: BAGenerateRequest, user: RateLimitedUser, db: DbDep
) -> BAArtifactResponse:
    """Generate a framework artifact (AI + deterministic fallback) and save it."""
    artifact = await svc.generate(db, user.id, payload.framework, payload.title, payload.context)
    return svc.to_response(artifact)


@router.get("", response_model=list[BAArtifactResponse])
async def list_artifacts(user: CurrentUser, db: DbDep) -> list[BAArtifactResponse]:
    return [svc.to_response(a) for a in await svc.list_for_user(db, user.id)]


@router.get("/{artifact_id}", response_model=BAArtifactResponse)
async def get_artifact(artifact_id: str, user: CurrentUser, db: DbDep) -> BAArtifactResponse:
    return svc.to_response(await svc.get(db, user.id, artifact_id))


@router.delete("/{artifact_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_artifact(artifact_id: str, user: CurrentUser, db: DbDep) -> Response:
    await svc.delete(db, user.id, artifact_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
