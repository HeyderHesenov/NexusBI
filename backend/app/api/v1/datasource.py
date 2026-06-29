"""DataSource endpoints."""
from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, File, Form, Response, UploadFile, status

from app.core.exceptions import SchemaNotFoundError
from app.dependencies import CacheDep, CurrentUser, DbDep
from app.schemas.datasource import (
    DataSourceCreate,
    DataSourceResponse,
    DataSourceSLAUpdate,
    PowerBIConnectRequest,
    PowerBIDataset,
)
from app.schemas.dataprep import ProfileResponse
from app.schemas.workspace import RLSRuleCreate, RLSRuleResponse
from app.services import audit_service, datasource_service as svc
from app.services import profiling_service, rls_service, upload_service

router = APIRouter(prefix="/datasource", tags=["datasource"])


@router.post("/", response_model=DataSourceResponse, status_code=status.HTTP_201_CREATED)
async def create(payload: DataSourceCreate, user: CurrentUser, db: DbDep) -> DataSourceResponse:
    ds = await svc.add_datasource(
        db, user.id, payload.name, payload.db_type, payload.connection_string
    )
    await audit_service.log(db, user.id, "datasource.create", entity="datasource", entity_id=ds.id)
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
    # pandas parse + to_sql are blocking/CPU-bound — keep them off the event loop.
    conn_str, _table, _rows = await asyncio.to_thread(
        upload_service.ingest_file, file.filename or "data.csv", content
    )
    label = name.strip() or (file.filename or "Yüklənmiş fayl")
    ds = await svc.add_datasource(db, user.id, label, "sqlite", conn_str)
    return DataSourceResponse.model_validate(ds)


@router.get("/powerbi/datasets", response_model=list[PowerBIDataset])
async def powerbi_datasets(user: CurrentUser) -> list[PowerBIDataset]:
    """List Power BI datasets available to connect (sample list in mock mode)."""
    from app.services.powerbi.provider import get_provider

    datasets = await get_provider().list_datasets()
    return [PowerBIDataset(**d) for d in datasets]


@router.post(
    "/connect-powerbi",
    response_model=DataSourceResponse,
    status_code=status.HTTP_201_CREATED,
)
async def connect_powerbi(
    payload: PowerBIConnectRequest, user: CurrentUser, db: DbDep
) -> DataSourceResponse:
    """Create a Power BI datasource pointing at a dataset (live DAX queries)."""
    import json

    config = json.dumps({"provider": "auto", "dataset_id": payload.dataset_id})
    ds = await svc.add_datasource(db, user.id, payload.name, "powerbi", config)
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
    ok = await svc.test_connection(ds)
    if ok:
        await svc.stamp_refreshed(db, ds)  # successful reach resets the freshness clock
    return {"ok": ok}


@router.patch("/{datasource_id}/sla", response_model=DataSourceResponse)
async def set_sla(
    datasource_id: str, payload: DataSourceSLAUpdate, user: CurrentUser, db: DbDep
) -> DataSourceResponse:
    """Set the freshness SLA (hours) used to flag a source as stale."""
    ds = await svc.set_sla(db, user.id, datasource_id, payload.freshness_sla_hours)
    return DataSourceResponse.model_validate(ds)


@router.get("/{datasource_id}/profile", response_model=ProfileResponse)
async def profile(
    datasource_id: str, table: str, user: CurrentUser, db: DbDep, cache: CacheDep
) -> ProfileResponse:
    """Per-column data profile (null %, distinct, min/max) for one table."""
    result = await profiling_service.profile(db, user.id, datasource_id, table, cache)
    return ProfileResponse(**result)


@router.delete("/{datasource_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete(datasource_id: str, user: CurrentUser, db: DbDep) -> Response:
    from app.core.security import decrypt_secret
    from app.db import engine_pool

    ds = await svc.get_datasource(db, user.id, datasource_id)
    await engine_pool.evict(decrypt_secret(ds.connection_string_encrypted))
    await db.delete(ds)
    await db.flush()
    await audit_service.log(db, user.id, "datasource.delete", entity="datasource", entity_id=datasource_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ─── Row-level security rules (datasource owner manages) ───

@router.get("/{datasource_id}/rls", response_model=list[RLSRuleResponse])
async def list_rls(datasource_id: str, user: CurrentUser, db: DbDep) -> list[RLSRuleResponse]:
    rules = await rls_service.list_for_datasource(db, user.id, datasource_id)
    return [RLSRuleResponse.model_validate(r) for r in rules]


@router.post("/{datasource_id}/rls", response_model=RLSRuleResponse, status_code=status.HTTP_201_CREATED)
async def add_rls(
    datasource_id: str, payload: RLSRuleCreate, user: CurrentUser, db: DbDep, cache: CacheDep
) -> RLSRuleResponse:
    from sqlalchemy import select

    from app.models.user import User

    member = (
        await db.execute(select(User).where(User.email == payload.member_email.strip().lower()))
    ).scalar_one_or_none()
    if member is None:
        raise SchemaNotFoundError("Bu e-poçtla istifadəçi tapılmadı.")
    rule = await rls_service.create_rule(
        db, user.id, datasource_id, member.id, payload.column, payload.allowed_value
    )
    # Tightening access must not leave stale, less-restricted rows in cache.
    await cache.delete_prefix(f"qcache:{datasource_id}:")
    await audit_service.log(
        db, user.id, "rls.create", entity="datasource", entity_id=datasource_id,
        meta={"member": member.id, "column": payload.column},
    )
    return RLSRuleResponse.model_validate(rule)


@router.delete("/{datasource_id}/rls/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_rls(
    datasource_id: str, rule_id: str, user: CurrentUser, db: DbDep, cache: CacheDep
) -> Response:
    await rls_service.delete_rule(db, user.id, rule_id)
    await cache.delete_prefix(f"qcache:{datasource_id}:")
    await audit_service.log(
        db, user.id, "rls.delete", entity="datasource", entity_id=datasource_id,
        meta={"rule": rule_id},
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
