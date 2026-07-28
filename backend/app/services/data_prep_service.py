"""NL data-prep orchestration: plan → preview → materialize as a new datasource."""
from __future__ import annotations

import asyncio
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.ai import data_prep
from app.ai.schema_introspector import format_schema_for_prompt
from app.ai.sql_guard import validate_select_only
from app.core.exceptions import NexusBIException, SchemaNotFoundError
from app.db import demo_data
from app.models.datasource import DataSource, DBType
from app.services import datasource_service, query_service, upload_service
from app.services.cache_service import CacheService

_PREVIEW_ROWS = 200


async def _schema_text(
    db: AsyncSession, user_id: str, datasource_id: str | None, cache: CacheService
) -> str:
    if not datasource_id:
        return demo_data.format_demo_schema()
    # Read path, so a workspace member the source is shared with resolves too —
    # the same lookup `guarded_read` uses below. RLS still narrows their rows.
    ds = await datasource_service.get_datasource_for_user(db, user_id, datasource_id)
    if ds.db_type == DBType.powerbi:
        raise SchemaNotFoundError("Power BI mənbələrində data-prep dəstəklənmir.")
    schema = await datasource_service.get_schema_cached(ds, cache)
    return format_schema_for_prompt(schema)


async def _run_select(
    db: AsyncSession, user_id: str, datasource_id: str | None, sql: str, cache: CacheService
) -> tuple[list[str], list[dict[str, Any]]]:
    """Execute planned or reviewed SQL through the app's one read guard chain.

    That chain is `query_service.guarded_read`: SELECT-only validation, the table
    allowlist (the ONLY place the touched tables are checked) and per-viewer RLS
    constraining before aggregation.

    Data-prep used to call `datasource_service.execute_select` directly, which
    re-validates SELECT-only and nothing else. Two guarantees leaked through the
    gap: planned SQL could name tables outside the source's schema, and it read
    every row regardless of the caller's RLS rules — one instruction away from the
    rows RLS exists to hide. The SQL here is LLM-planned or client-posted, so it
    is untrusted on both paths. Never add a second execution path in this module.
    """
    clean_sql = validate_select_only(sql)  # cheap rejection before any DB work
    return await query_service.guarded_read(clean_sql, datasource_id, user_id, db, cache)


async def preview(
    db: AsyncSession,
    user_id: str,
    datasource_id: str | None,
    instruction: str,
    cache: CacheService,
) -> dict[str, Any]:
    """Plan an NL transform into SQL and run it, returning a bounded preview."""
    schema_text = await _schema_text(db, user_id, datasource_id, cache)
    plan = await data_prep.plan_transform(schema_text, instruction)
    if not plan["sql"]:
        raise NexusBIException("Transform planı yaradıla bilmədi.", detail="; ".join(plan["warnings"]))
    columns, rows = await _run_select(db, user_id, datasource_id, plan["sql"], cache)
    return {
        "sql": plan["sql"],
        "steps": plan["steps"],
        "warnings": plan["warnings"],
        "columns": columns,
        "rows": rows[:_PREVIEW_ROWS],
    }


async def materialize(
    db: AsyncSession,
    user_id: str,
    datasource_id: str | None,
    sql: str,
    name: str,
    cache: CacheService,
) -> DataSource:
    """Run the reviewed SQL and persist the result as a new SQLite datasource."""
    columns, rows = await _run_select(db, user_id, datasource_id, sql, cache)
    if not rows:
        raise NexusBIException("Nəticə boşdur — saxlanmadı.")
    # pandas parse + to_sql are blocking — keep them off the event loop.
    conn_str, _table, _n = await asyncio.to_thread(
        upload_service.materialize_rows, columns, rows, name
    )
    return await datasource_service.add_datasource(
        db, user_id, name, "sqlite", conn_str, internal=True
    )
