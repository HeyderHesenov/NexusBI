"""DataSource lifecycle: create, list, test, schema, encrypted execution."""
from __future__ import annotations

from typing import Any

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from app.ai.schema_introspector import format_schema_for_prompt, get_schema
from app.core.exceptions import DataSourceConnectionError, SchemaNotFoundError
from app.core.security import decrypt_secret, encrypt_secret
from app.models.datasource import DataSource, DBType
from app.services.cache_service import CacheService


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


async def test_connection(ds: DataSource) -> bool:
    conn_str = decrypt_secret(ds.connection_string_encrypted)
    engine = create_async_engine(conn_str)
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        return True
    except Exception as exc:
        raise DataSourceConnectionError("Bağlantı uğursuz.", detail=str(exc)) from exc
    finally:
        await engine.dispose()


async def get_schema_cached(
    ds: DataSource, cache: CacheService
) -> dict[str, Any]:
    """Return schema, preferring cache, then introspection."""
    cached = await cache.get(f"schema:{ds.id}")
    if cached:
        return cached
    conn_str = decrypt_secret(ds.connection_string_encrypted)
    schema = await get_schema(conn_str)
    await cache.set(f"schema:{ds.id}", schema, ttl=3600)
    return schema


async def execute_select(ds: DataSource, sql: str) -> tuple[list[str], list[dict[str, Any]]]:
    """Run a validated SELECT and return (columns, rows)."""
    conn_str = decrypt_secret(ds.connection_string_encrypted)
    engine = create_async_engine(conn_str)
    try:
        async with engine.connect() as conn:
            result = await conn.execute(text(sql))
            columns = list(result.keys())
            rows = [dict(r) for r in result.mappings().all()]
        return columns, rows
    except Exception as exc:
        raise DataSourceConnectionError("Sorğu icra olunmadı.", detail=str(exc)) from exc
    finally:
        await engine.dispose()


def schema_as_prompt(schema: dict[str, Any]) -> str:
    return format_schema_for_prompt(schema)
