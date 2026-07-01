"""Saved query endpoints — named NL queries with optional refresh schedules."""
from __future__ import annotations

from fastapi import APIRouter, Response, status

from app.dependencies import CacheDep, CurrentUser, DbDep, RateLimitedUser
from app.schemas.query import QueryResult
from app.schemas.report_subscription import SubscriptionCreate, SubscriptionResponse
from app.schemas.saved_query import (
    SavedQueryCreate,
    SavedQueryResponse,
    SavedQueryUpdate,
)
from app.services import report_delivery_service, saved_query_service as svc

router = APIRouter(prefix="/saved", tags=["saved"])


def _sub_response(sub) -> SubscriptionResponse:
    return SubscriptionResponse(
        id=sub.id, saved_query_id=sub.saved_query_id, recipient=sub.recipient,
        format=sub.format, schedule=sub.schedule, active=sub.active,
        last_sent_at=sub.last_sent_at.isoformat() if sub.last_sent_at else None,
    )


@router.post("/", response_model=SavedQueryResponse, status_code=status.HTTP_201_CREATED)
async def create(payload: SavedQueryCreate, user: CurrentUser, db: DbDep) -> SavedQueryResponse:
    sq = await svc.create(db, user.id, payload)
    return SavedQueryResponse.model_validate(sq)


@router.get("/", response_model=list[SavedQueryResponse])
async def list_all(user: CurrentUser, db: DbDep) -> list[SavedQueryResponse]:
    items = await svc.list_for_user(db, user.id)
    return [SavedQueryResponse.model_validate(s) for s in items]


@router.put("/{saved_id}", response_model=SavedQueryResponse)
async def update(
    saved_id: str, payload: SavedQueryUpdate, user: CurrentUser, db: DbDep
) -> SavedQueryResponse:
    sq = await svc.update(db, user.id, saved_id, payload)
    return SavedQueryResponse.model_validate(sq)


@router.delete("/{saved_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete(saved_id: str, user: CurrentUser, db: DbDep) -> Response:
    await svc.delete(db, user.id, saved_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{saved_id}/run", response_model=QueryResult)
async def run(saved_id: str, user: RateLimitedUser, db: DbDep, cache: CacheDep) -> QueryResult:
    sq = await svc.get(db, user.id, saved_id)
    return await svc.run(db, cache, sq)


@router.post(
    "/{saved_id}/subscriptions",
    response_model=SubscriptionResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_subscription(
    saved_id: str, payload: SubscriptionCreate, user: CurrentUser, db: DbDep
) -> SubscriptionResponse:
    sub = await report_delivery_service.create_subscription(
        db, user.id, saved_id, payload.recipient, payload.format, payload.schedule
    )
    return _sub_response(sub)


@router.get("/{saved_id}/subscriptions", response_model=list[SubscriptionResponse])
async def list_subscriptions(
    saved_id: str, user: CurrentUser, db: DbDep
) -> list[SubscriptionResponse]:
    subs = await report_delivery_service.list_for_saved(db, user.id, saved_id)
    return [_sub_response(s) for s in subs]


@router.delete("/subscriptions/{sub_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_subscription(sub_id: str, user: CurrentUser, db: DbDep) -> Response:
    await report_delivery_service.delete_subscription(db, user.id, sub_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
