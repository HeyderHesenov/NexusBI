"""DataSource lifecycle: create, list, test, schema, encrypted execution."""
from __future__ import annotations

import json
import time
from typing import Any

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.schema_introspector import format_schema_for_prompt, get_schema
from app.ai.sql_guard import validate_select_only
from app.core import metrics
from app.core.exceptions import DataSourceConnectionError, SchemaNotFoundError
from app.db import engine_pool
from app.core.logging import get_logger
from app.core.security import decrypt_secret, encrypt_secret
from app.models.datasource import DataSource, DBType
from app.services.cache_service import CacheService

log = get_logger("nexusbi.sql")


async def add_datasource(
    db: AsyncSession, user_id: str, name: str, db_type: str, connection_string: str
) -> DataSource:
    ds = DataSource(
        user_id=user_id,
        name=name,
        db_type=DBType(db_type),
        connection_string_encrypted=encrypt_secret(connection_string),
    )
    db.add(ds)
    await db.flush()
    await db.refresh(ds)
    return ds


async def list_datasources(db: AsyncSession, user_id: str) -> list[DataSource]:
    result = await db.execute(
        select(DataSource).where(DataSource.user_id == user_id)
    )
    return list(result.scalars().all())


async def get_datasource(db: AsyncSession, user_id: str, datasource_id: str) -> DataSource:
    result = await db.execute(
        select(DataSource).where(
            DataSource.id == datasource_id, DataSource.user_id == user_id
        )
    )
    ds = result.scalar_one_or_none()
    if ds is None:
        raise SchemaNotFoundError("DataSource tapılmadı.")
    return ds


def powerbi_config(ds: DataSource) -> dict[str, Any]:
    """Decrypt and parse a Power BI datasource's stored config JSON."""
    return json.loads(decrypt_secret(ds.connection_string_encrypted))


async def test_connection(ds: DataSource) -> bool:
    if ds.db_type == DBType.powerbi:
        from app.services.powerbi.provider import get_provider

        try:
            datasets = await get_provider().list_datasets()
            return bool(datasets)
        except Exception as exc:
            raise DataSourceConnectionError("Power BI bağlantısı uğursuz.", detail=str(exc)) from exc
    conn_str = decrypt_secret(ds.connection_string_encrypted)
    engine = await engine_pool.get_engine(conn_str)
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        return True
    except Exception as exc:
        raise DataSourceConnectionError("Bağlantı uğursuz.", detail=str(exc)) from exc


async def get_schema_cached(
    ds: DataSource, cache: CacheService
) -> dict[str, Any]:
    """Return schema, preferring cache, then introspection (or provider)."""
    cached = await cache.get(f"schema:{ds.id}")
    if cached:
        return cached
    if ds.db_type == DBType.powerbi:
        from app.services.powerbi.provider import get_provider

        cfg = powerbi_config(ds)
        schema = await get_provider().get_model_schema(cfg["dataset_id"])
    else:
        conn_str = decrypt_secret(ds.connection_string_encrypted)
        schema = await get_schema(conn_str)
    await cache.set(f"schema:{ds.id}", schema, ttl=3600)
    return schema


MAX_RESULT_ROWS = 10000


async def execute_select(ds: DataSource, sql: str) -> tuple[list[str], list[dict[str, Any]]]:
    """Run a validated SELECT and return (columns, rows).

    Re-validates at the executor (defense in depth — never trust the caller) and
    hard-caps fetched rows so a huge result can't exhaust memory.
    """
    sql = validate_select_only(sql)
    conn_str = decrypt_secret(ds.connection_string_encrypted)
    engine = await engine_pool.get_engine(conn_str)
    started = time.perf_counter()
    try:
        async with engine.connect() as conn:
            result = await conn.execute(text(sql))
            columns = list(result.keys())
            rows = [dict(r) for r in result.mappings().fetchmany(MAX_RESULT_ROWS)]
        log.info(
            "sql_execution",
            datasource_id=ds.id,
            execution_time_ms=int((time.perf_counter() - started) * 1000),
            row_count=len(rows),
        )
        metrics.sql_executions_total.labels("success").inc()
        return columns, rows
    except Exception as exc:
        metrics.sql_executions_total.labels("error").inc()
        raise DataSourceConnectionError("Sorğu icra olunmadı.", detail=str(exc)) from exc


def schema_as_prompt(schema: dict[str, Any]) -> str:
    return format_schema_for_prompt(schema)
