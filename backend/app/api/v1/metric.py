"""Metric (semantic layer) endpoints."""
from __future__ import annotations

from fastapi import APIRouter, Query, Response, status

from app.dependencies import CurrentUser, DbDep
from app.schemas.metric import MetricCreate, MetricResponse, MetricVerifyRequest
from app.services import metric_service as svc

router = APIRouter(prefix="/metrics", tags=["metrics"])


@router.post("/", response_model=MetricResponse, status_code=status.HTTP_201_CREATED)
async def create(payload: MetricCreate, user: CurrentUser, db: DbDep) -> MetricResponse:
    metric = await svc.create(db, user.id, payload)
    return MetricResponse.model_validate(metric)


@router.get("/", response_model=list[MetricResponse])
async def list_all(
    user: CurrentUser, db: DbDep, datasource_id: str | None = Query(default=None)
) -> list[MetricResponse]:
    items = await svc.list_for(db, user.id, datasource_id)
    return [MetricResponse.model_validate(m) for m in items]


@router.patch("/{metric_id}/verify", response_model=MetricResponse)
async def verify(
    metric_id: str, payload: MetricVerifyRequest, user: CurrentUser, db: DbDep
) -> MetricResponse:
    """Certify (or un-certify) a metric — marks the trusted source of truth."""
    by = user.full_name or user.email
    metric = await svc.set_verified(db, user.id, metric_id, payload.verified, by)
    return MetricResponse.model_validate(metric)


@router.delete("/{metric_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete(metric_id: str, user: CurrentUser, db: DbDep) -> Response:
    await svc.delete(db, user.id, metric_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
