"""Metric tree (KPI decomposition) endpoints."""
from __future__ import annotations

from fastapi import APIRouter, Response, status

from app.dependencies import CurrentUser, DbDep
from app.schemas.metric_tree import (
    EvaluatedNode,
    MetricNodeCreate,
    MetricNodeResponse,
    MetricNodeUpdate,
)
from app.services import metric_tree_service as svc

router = APIRouter(prefix="/metric-tree", tags=["metric-tree"])


@router.get("/", response_model=list[MetricNodeResponse])
async def list_nodes(user: CurrentUser, db: DbDep) -> list[MetricNodeResponse]:
    return [MetricNodeResponse.model_validate(n) for n in await svc.list_nodes(db, user.id)]


@router.get("/evaluate", response_model=list[EvaluatedNode])
async def evaluate(user: CurrentUser, db: DbDep) -> list[EvaluatedNode]:
    return [EvaluatedNode.model_validate(n) for n in await svc.evaluate(db, user.id)]


@router.post("/", response_model=MetricNodeResponse, status_code=status.HTTP_201_CREATED)
async def create(payload: MetricNodeCreate, user: CurrentUser, db: DbDep) -> MetricNodeResponse:
    return MetricNodeResponse.model_validate(await svc.create(db, user.id, payload))


@router.patch("/{node_id}", response_model=MetricNodeResponse)
async def update(node_id: str, payload: MetricNodeUpdate, user: CurrentUser, db: DbDep) -> MetricNodeResponse:
    return MetricNodeResponse.model_validate(await svc.update(db, user.id, node_id, payload))


@router.delete("/{node_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete(node_id: str, user: CurrentUser, db: DbDep) -> Response:
    await svc.delete(db, user.id, node_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
