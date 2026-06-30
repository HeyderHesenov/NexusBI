"""Decision (Insight → Action → Outcome) endpoints + Decision Intelligence Loop."""
from __future__ import annotations

from fastapi import APIRouter, Response, status

from app.dependencies import CacheDep, CurrentUser, DbDep, RateLimitedUser
from app.schemas.decision import (
    AccuracySummary,
    DecisionCreate,
    DecisionMeasurementResponse,
    DecisionResponse,
    DecisionROI,
    DecisionUpdate,
)
from app.services import decision_service as svc

router = APIRouter(prefix="/decisions", tags=["decisions"])


@router.post("/", response_model=DecisionResponse, status_code=status.HTTP_201_CREATED)
async def create(
    payload: DecisionCreate, user: CurrentUser, db: DbDep, cache: CacheDep
) -> DecisionResponse:
    return DecisionResponse.model_validate(await svc.create(db, cache, user.id, payload))


@router.get("/", response_model=list[DecisionResponse])
async def list_all(user: CurrentUser, db: DbDep) -> list[DecisionResponse]:
    return [DecisionResponse.model_validate(d) for d in await svc.list_for_user(db, user.id)]


@router.get("/accuracy", response_model=AccuracySummary)
async def accuracy(user: CurrentUser, db: DbDep) -> AccuracySummary:
    return AccuracySummary.model_validate(await svc.accuracy_summary(db, user.id))


@router.put("/{decision_id}", response_model=DecisionResponse)
async def update(
    decision_id: str, payload: DecisionUpdate, user: CurrentUser, db: DbDep
) -> DecisionResponse:
    return DecisionResponse.model_validate(await svc.update(db, user.id, decision_id, payload))


@router.post("/{decision_id}/measure", response_model=DecisionROI)
async def measure(
    decision_id: str, user: RateLimitedUser, db: DbDep, cache: CacheDep
) -> DecisionROI:
    d = await svc.get(db, user.id, decision_id)
    d = await svc.measure(db, cache, d)
    return DecisionROI.model_validate(svc.roi(d))


@router.get("/{decision_id}/roi", response_model=DecisionROI)
async def roi(decision_id: str, user: CurrentUser, db: DbDep) -> DecisionROI:
    d = await svc.get(db, user.id, decision_id)
    return DecisionROI.model_validate(svc.roi(d))


@router.get("/{decision_id}/trajectory", response_model=list[DecisionMeasurementResponse])
async def trajectory(
    decision_id: str, user: CurrentUser, db: DbDep
) -> list[DecisionMeasurementResponse]:
    points = await svc.trajectory(db, user.id, decision_id)
    return [DecisionMeasurementResponse.model_validate(p) for p in points]


@router.delete("/{decision_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete(decision_id: str, user: CurrentUser, db: DbDep) -> Response:
    await svc.delete(db, user.id, decision_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
