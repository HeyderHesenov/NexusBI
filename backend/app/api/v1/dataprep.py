"""NL data-prep endpoints: preview a transform and materialize it as a datasource."""
from __future__ import annotations

from fastapi import APIRouter, Depends, status

from app.core.rate_limit import rate_limit
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


# No LLM call here, so the monthly AI quota is the wrong control — but each call
# runs client-supplied SQL and writes a new SQLite file, so it cannot be unbounded.
_materialize_limit = rate_limit("dataprep_materialize", limit=10, window_seconds=60)


@router.post(
    "/materialize",
    response_model=DataSourceResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(_materialize_limit)],
)
async def materialize(
    payload: DataPrepMaterializeRequest, user: CurrentUser, db: DbDep, cache: CacheDep
) -> DataSourceResponse:
    """Persist the reviewed transform result as a new SQLite datasource."""
    ds = await svc.materialize(
        db, user.id, payload.datasource_id, payload.sql, payload.name, cache
    )
    return DataSourceResponse.model_validate(ds)
