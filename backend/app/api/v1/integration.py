"""Workflow integration channel endpoints (Slack / Teams / email)."""
from __future__ import annotations

from fastapi import APIRouter, Response, status

from app.dependencies import CurrentUser, DbDep
from app.schemas.integration import IntegrationCreate, IntegrationResponse
from app.services import integration_service as svc

router = APIRouter(prefix="/integrations", tags=["integrations"])


@router.post("", response_model=IntegrationResponse, status_code=status.HTTP_201_CREATED)
async def create(payload: IntegrationCreate, user: CurrentUser, db: DbDep) -> IntegrationResponse:
    ch = await svc.create(db, user.id, payload.type, payload.name, payload.target)
    return IntegrationResponse.model_validate(ch)


@router.get("", response_model=list[IntegrationResponse])
async def list_all(user: CurrentUser, db: DbDep) -> list[IntegrationResponse]:
    return [IntegrationResponse.model_validate(c) for c in await svc.list_for_user(db, user.id)]


@router.post("/{channel_id}/test")
async def test(channel_id: str, user: CurrentUser, db: DbDep) -> dict[str, bool]:
    return {"ok": await svc.send_test(db, user.id, channel_id)}


@router.delete("/{channel_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete(channel_id: str, user: CurrentUser, db: DbDep) -> Response:
    await svc.delete(db, user.id, channel_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
