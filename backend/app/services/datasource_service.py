"""DataSource lifecycle: create, list, test, schema, encrypted execution."""
from __future__ import annotations

import asyncio
import json
import time
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.schema_introspector import format_schema_for_prompt, get_schema
from app.ai.sql_guard import validate_select_only
from app.config import settings
from app.core import metrics, net_guard
from app.core.exceptions import DataSourceConnectionError, SchemaNotFoundError
from app.db import engine_pool
from app.core.logging import get_logger
from app.core.security import decrypt_secret, encrypt_secret
from app.models.datasource import DataSource, DBType
from app.services.cache_service import CacheService

log = get_logger("nexusbi.sql")


async def _guard_conn_str(conn_str: str) -> None:
    """SSRF check (DNS resolution is blocking → off-loop). Skip in tests-friendly
    fashion handled by the guard itself for sqlite/file URLs."""
    await asyncio.to_thread(net_guard.assert_safe_connection_string, conn_str)


async def add_datasource(
    db: AsyncSession, user_id: str, name: str, db_type: str, connection_string: str
) -> DataSource:
    dtype = DBType(db_type)
    if dtype != DBType.powerbi:  # powerbi stores a JSON config, not a SQLAlchemy URL
        await _guard_conn_str(connection_string)
    ds = DataSource(
        user_id=user_id,
        name=name,
        db_type=dtype,
        connection_string_encrypted=encrypt_secret(connection_string),
        last_refreshed_at=datetime.now(timezone.utc),
    )
    db.add(ds)
    await db.flush()
    await db.refresh(ds)
    return ds


async def set_sla(
    db: AsyncSession, user_id: str, datasource_id: str, hours: int | None
) -> DataSource:
    ds = await get_datasource(db, user_id, datasource_id)
    ds.freshness_sla_hours = hours
    await db.flush()
    await db.refresh(ds)
    return ds


async def stamp_refreshed(db: AsyncSession, ds: DataSource) -> None:
    """Mark the source as freshly reached (resets the freshness clock)."""
    ds.last_refreshed_at = datetime.now(timezone.utc)
    await db.flush()


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
    await _guard_conn_str(conn_str)  # re-check at connect time (DNS-rebind window)
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
        await _guard_conn_str(conn_str)
        schema = await get_schema(conn_str)
    await cache.set(f"schema:{ds.id}", schema, ttl=3600)
    return schema


MAX_RESULT_ROWS = 10000


def _dedupe_columns(columns: list[str]) -> list[str]:
    """Make column names unique (id, id_2, id_3…) so JOIN/SELECT * results don't
    silently collapse duplicate names when rows are built as dicts."""
    seen: dict[str, int] = {}
    out: list[str] = []
    for col in columns:
        n = seen.get(col, 0)
        seen[col] = n + 1
        out.append(col if n == 0 else f"{col}_{n + 1}")
    return out


async def execute_select(ds: DataSource, sql: str) -> tuple[list[str], list[dict[str, Any]]]:
    """Run a validated SELECT and return (columns, rows).

    Re-validates at the executor (defense in depth — never trust the caller) and
    hard-caps fetched rows so a huge result can't exhaust memory. Duplicate column
    names (common in joins) are made unique so no column is silently dropped.
    """
    sql = validate_select_only(sql)
    conn_str = decrypt_secret(ds.connection_string_encrypted)
    await _guard_conn_str(conn_str)
    engine = await engine_pool.get_engine(conn_str)
    started = time.perf_counter()
    timeout = settings.QUERY_TIMEOUT_SECONDS
    try:
        async with engine.connect() as conn:
            # DB-side cap (Postgres cancels server-side); asyncio.wait_for bounds
            # every dialect so a runaway query can't pin a pooled connection.
            if ds.db_type == DBType.postgresql:
                await conn.execute(text(f"SET statement_timeout = {timeout * 1000}"))
            result = await asyncio.wait_for(conn.execute(text(sql)), timeout=timeout + 2)
            columns = _dedupe_columns(list(result.keys()))
            raw = result.fetchmany(MAX_RESULT_ROWS)
            rows = [dict(zip(columns, r)) for r in raw]
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
