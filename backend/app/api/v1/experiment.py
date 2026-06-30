"""A/B experiment endpoints."""
from __future__ import annotations

from fastapi import APIRouter, Response, status

from app.dependencies import CurrentUser, DbDep
from app.schemas.experiment import ExperimentCreate, ExperimentResponse
from app.services import ab_service as svc

router = APIRouter(prefix="/experiments", tags=["experiments"])


@router.post("/", response_model=ExperimentResponse, status_code=status.HTTP_201_CREATED)
async def create(payload: ExperimentCreate, user: CurrentUser, db: DbDep) -> ExperimentResponse:
    return ExperimentResponse.model_validate(await svc.create(db, user.id, payload))


@router.get("/", response_model=list[ExperimentResponse])
async def list_experiments(user: CurrentUser, db: DbDep) -> list[ExperimentResponse]:
    return [ExperimentResponse.model_validate(e) for e in await svc.list_for(db, user.id)]


@router.post("/{experiment_id}/analyze", response_model=ExperimentResponse)
async def analyze(experiment_id: str, user: CurrentUser, db: DbDep) -> ExperimentResponse:
    return ExperimentResponse.model_validate(await svc.analyze(db, user.id, experiment_id))


@router.delete("/{experiment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete(experiment_id: str, user: CurrentUser, db: DbDep) -> Response:
    await svc.delete(db, user.id, experiment_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
