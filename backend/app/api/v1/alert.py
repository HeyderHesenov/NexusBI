"""Alert (monitor) + notification endpoints."""
from __future__ import annotations

from fastapi import APIRouter, Response, status

from app.dependencies import CurrentUser, DbDep, RateLimitedUser
from app.schemas.alert import AlertCreate, AlertResponse, NotificationResponse
from app.services import alert_service as svc
from app.services import digest_service

router = APIRouter(tags=["alerts"])


@router.post("/alerts", response_model=AlertResponse, status_code=status.HTTP_201_CREATED)
async def create_alert(payload: AlertCreate, user: CurrentUser, db: DbDep) -> AlertResponse:
    alert = await svc.create(db, user.id, payload)
    return AlertResponse.model_validate(alert)


@router.get("/alerts", response_model=list[AlertResponse])
async def list_alerts(user: CurrentUser, db: DbDep) -> list[AlertResponse]:
    return [AlertResponse.model_validate(a) for a in await svc.list_for_user(db, user.id)]


@router.delete("/alerts/{alert_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_alert(alert_id: str, user: CurrentUser, db: DbDep) -> Response:
    await svc.delete(db, user.id, alert_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/notifications", response_model=list[NotificationResponse])
async def list_notifications(user: CurrentUser, db: DbDep) -> list[NotificationResponse]:
    items = await svc.list_notifications(db, user.id)
    return [NotificationResponse.model_validate(n) for n in items]


@router.post("/notifications/digest")
async def build_digest(user: RateLimitedUser, db: DbDep) -> dict[str, int]:
    """On-demand proactive brief: roll the user's notable changes into one notification."""
    notif = await digest_service.build_digest(db, user.id)
    return {"created": 1 if notif is not None else 0}


@router.post("/notifications/read-all", status_code=status.HTTP_204_NO_CONTENT)
async def read_all(user: CurrentUser, db: DbDep) -> Response:
    await svc.mark_all_read(db, user.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/notifications/{notif_id}/read", status_code=status.HTTP_204_NO_CONTENT)
async def read_one(notif_id: str, user: CurrentUser, db: DbDep) -> Response:
    await svc.mark_read(db, user.id, notif_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
