"""DataSource endpoints."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, File, Form, Response, UploadFile, status

from app.dependencies import CacheDep, CurrentUser, DbDep
from app.schemas.datasource import DataSourceCreate, DataSourceResponse
from app.services import datasource_service as svc
from app.services import upload_service

router = APIRouter(prefix="/datasource", tags=["datasource"])


@router.post("/", response_model=DataSourceResponse, status_code=status.HTTP_201_CREATED)
async def create(payload: DataSourceCreate, user: CurrentUser, db: DbDep) -> DataSourceResponse:
    ds = await svc.add_datasource(
        db, user.id, payload.name, payload.db_type, payload.connection_string
    )
    return DataSourceResponse.model_validate(ds)


@router.post("/upload", response_model=DataSourceResponse, status_code=status.HTTP_201_CREATED)
async def upload(
    user: CurrentUser,
    db: DbDep,
    file: UploadFile = File(...),
    name: str = Form(default=""),
) -> DataSourceResponse:
    """Ingest a CSV/Excel file into a SQLite-backed datasource owned by the user."""
    content = await file.read()
    conn_str, _table, _rows = upload_service.ingest_file(file.filename or "data.csv", content)
    label = name.strip() or (file.filename or "Yüklənmiş fayl")
    ds = await svc.add_datasource(db, user.id, label, "sqlite", conn_str)
    return DataSourceResponse.model_validate(ds)


@router.get("/", response_model=list[DataSourceResponse])
async def list_all(user: CurrentUser, db: DbDep) -> list[DataSourceResponse]:
    items = await svc.list_datasources(db, user.id)
    return [DataSourceResponse.model_validate(d) for d in items]


@router.get("/{datasource_id}/schema")
async def schema(
    datasource_id: str, user: CurrentUser, db: DbDep, cache: CacheDep
) -> dict[str, Any]:
    ds = await svc.get_datasource(db, user.id, datasource_id)
    return await svc.get_schema_cached(ds, cache)


@router.post("/{datasource_id}/test")
async def test(datasource_id: str, user: CurrentUser, db: DbDep) -> dict[str, bool]:
    ds = await svc.get_datasource(db, user.id, datasource_id)
    return {"ok": await svc.test_connection(ds)}


@router.delete("/{datasource_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete(datasource_id: str, user: CurrentUser, db: DbDep) -> Response:
    ds = await svc.get_datasource(db, user.id, datasource_id)
    await db.delete(ds)
    await db.flush()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
