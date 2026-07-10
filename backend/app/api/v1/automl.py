"""AutoML studio endpoints: train / list / predict / delete.

Training is CPU-bound, not AI-quota-bound → per-IP rate limit instead of the
AI quota (mirrors the SQL power-user endpoint's approach).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Response, status

from app.core.rate_limit import rate_limit
from app.db.demo_data import demo_column_meta
from app.dependencies import CacheDep, CurrentUser, DbDep
from app.schemas.automl import (
    AutoMLTable,
    AutoMLTableColumn,
    MLModelOut,
    PredictRequest,
    PredictResponse,
    TrainRequest,
)
from app.services import automl_service as svc

router = APIRouter(prefix="/automl", tags=["automl"])


@router.get("/tables", response_model=list[AutoMLTable])
async def tables(user: CurrentUser) -> list[AutoMLTable]:
    """Demo tables + columns the wizard can train on."""
    return [
        AutoMLTable(
            name=table,
            columns=[AutoMLTableColumn(name=c, dtype=d) for c, d, _ in cols],
        )
        for table, cols in demo_column_meta().items()
    ]


@router.post(
    "/train",
    response_model=MLModelOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(rate_limit("automl_train", 5, 60))],
)
async def train(payload: TrainRequest, user: CurrentUser, db: DbDep, cache: CacheDep) -> MLModelOut:
    model = await svc.train(
        db, cache, user.id, payload.name, payload.source_table, payload.datasource_id, payload.target_column
    )
    return svc.to_response(model)


@router.get("/models", response_model=list[MLModelOut])
async def list_models(user: CurrentUser, db: DbDep) -> list[MLModelOut]:
    return [svc.to_response(m) for m in await svc.list_for_user(db, user.id)]


@router.post(
    "/models/{model_id}/predict",
    response_model=PredictResponse,
    dependencies=[Depends(rate_limit("automl_predict", 30, 60))],
)
async def predict(
    model_id: str, payload: PredictRequest, user: CurrentUser, db: DbDep
) -> PredictResponse:
    preds, explanations = await svc.predict(db, user.id, model_id, payload.rows)
    return PredictResponse(predictions=preds, explanations=explanations)


@router.delete("/models/{model_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_model(model_id: str, user: CurrentUser, db: DbDep) -> Response:
    await svc.delete(db, user.id, model_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
