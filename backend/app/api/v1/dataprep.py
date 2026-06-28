"""NL data-prep endpoints: preview a transform and materialize it as a datasource."""
from __future__ import annotations

from fastapi import APIRouter, status

from app.dependencies import CacheDep, CurrentUser, DbDep, RateLimitedUser
from app.schemas.datasource import DataSourceResponse
from app.schemas.dataprep import (
    DataPrepMaterializeRequest,
    DataPrepPreviewRequest,
    DataPrepPreviewResponse,
)
from app.services import data_prep_service as svc

router = APIRouter(prefix="/dataprep", tags=["dataprep"])


@router.post("/preview", response_model=DataPrepPreviewResponse)
async def preview(
    payload: DataPrepPreviewRequest, user: RateLimitedUser, db: DbDep, cache: CacheDep
) -> DataPrepPreviewResponse:
    """Plan an NL transform into a SELECT and run it (bounded preview)."""
    result = await svc.preview(db, user.id, payload.datasource_id, payload.instruction, cache)
    return DataPrepPreviewResponse(**result)


@router.post("/materialize", response_model=DataSourceResponse, status_code=status.HTTP_201_CREATED)
async def materialize(
    payload: DataPrepMaterializeRequest, user: CurrentUser, db: DbDep, cache: CacheDep
) -> DataSourceResponse:
    """Persist the reviewed transform result as a new SQLite datasource."""
    ds = await svc.materialize(
        db, user.id, payload.datasource_id, payload.sql, payload.name, cache
    )
    return DataSourceResponse.model_validate(ds)
