"""Alert (monitor) + notification endpoints."""
from __future__ import annotations

from fastapi import APIRouter, Response, status

from app.dependencies import CurrentUser, DbDep
from app.schemas.alert import AlertCreate, AlertResponse, NotificationResponse
from app.services import alert_service as svc
from app.services import insight_service

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


@router.post("/notifications/generate-insights")
async def generate_insights(user: CurrentUser, db: DbDep) -> dict[str, int]:
    """Scan the user's recent queries and emit notable smart-insight notifications."""
    created = await insight_service.generate_for_user(db, user.id)
    return {"created": created}


@router.post("/notifications/read-all", status_code=status.HTTP_204_NO_CONTENT)
async def read_all(user: CurrentUser, db: DbDep) -> Response:
    await svc.mark_all_read(db, user.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/notifications/{notif_id}/read", status_code=status.HTTP_204_NO_CONTENT)
async def read_one(notif_id: str, user: CurrentUser, db: DbDep) -> Response:
    await svc.mark_read(db, user.id, notif_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
