"""Decision (Insight → Action → Outcome) endpoints."""
from __future__ import annotations

from fastapi import APIRouter, Response, status

from app.dependencies import CurrentUser, DbDep
from app.schemas.decision import DecisionCreate, DecisionResponse, DecisionUpdate
from app.services import decision_service as svc

router = APIRouter(prefix="/decisions", tags=["decisions"])


@router.post("/", response_model=DecisionResponse, status_code=status.HTTP_201_CREATED)
async def create(payload: DecisionCreate, user: CurrentUser, db: DbDep) -> DecisionResponse:
    return DecisionResponse.model_validate(await svc.create(db, user.id, payload))


@router.get("/", response_model=list[DecisionResponse])
async def list_all(user: CurrentUser, db: DbDep) -> list[DecisionResponse]:
    return [DecisionResponse.model_validate(d) for d in await svc.list_for_user(db, user.id)]


@router.put("/{decision_id}", response_model=DecisionResponse)
async def update(
    decision_id: str, payload: DecisionUpdate, user: CurrentUser, db: DbDep
) -> DecisionResponse:
    return DecisionResponse.model_validate(await svc.update(db, user.id, decision_id, payload))


@router.delete("/{decision_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete(decision_id: str, user: CurrentUser, db: DbDep) -> Response:
    await svc.delete(db, user.id, decision_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
