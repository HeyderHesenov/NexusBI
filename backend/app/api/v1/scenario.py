"""KPI targets + scenario-planning endpoints."""
from __future__ import annotations

from fastapi import APIRouter, Response, status

from app.dependencies import CurrentUser, DbDep
from app.schemas.scenario import (
    KPITargetCreate,
    KPITargetResponse,
    KPITargetUpdate,
)
from app.services import kpi_target_service as svc

router = APIRouter(prefix="/kpi-targets", tags=["scenario"])


@router.post("", response_model=KPITargetResponse, status_code=status.HTTP_201_CREATED)
async def create(payload: KPITargetCreate, user: CurrentUser, db: DbDep) -> KPITargetResponse:
    t = await svc.create(db, user.id, payload)
    return svc.to_response(t)


@router.get("", response_model=list[KPITargetResponse])
async def list_all(user: CurrentUser, db: DbDep) -> list[KPITargetResponse]:
    return [svc.to_response(t) for t in await svc.list_for_user(db, user.id)]


@router.patch("/{target_id}", response_model=KPITargetResponse)
async def update(
    target_id: str, payload: KPITargetUpdate, user: CurrentUser, db: DbDep
) -> KPITargetResponse:
    t = await svc.update(db, user.id, target_id, payload)
    return svc.to_response(t)


@router.delete("/{target_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete(target_id: str, user: CurrentUser, db: DbDep) -> Response:
    await svc.delete(db, user.id, target_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
