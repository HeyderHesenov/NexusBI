"""Core orchestration: NL query -> SQL -> execute -> chart -> insight -> log."""
from __future__ import annotations

import asyncio
import hashlib
import time
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.chart_selector import select_chart_type
from app.ai.insight_generator import generate_insight
from app.ai.text2sql import Text2SQLEngine
from app.ai.types import ChartConfig, Text2SQLResult
from app.config import settings
from app.models.query_log import QueryLog
from app.schemas.query import ColumnInfo, QueryResult
from app.services import datasource_service as ds_service
from app.services.cache_service import CacheService


def _cache_key(datasource_id: str | None, nl_query: str) -> str:
    h = hashlib.sha1(nl_query.strip().lower().encode()).hexdigest()
    return f"qcache:{datasource_id or 'demo'}:{h}"

_engine = Text2SQLEngine()

_SNAPSHOT_MAX_ROWS = 1000
_SNAPSHOT_MAX_BYTES = 256 * 1024  # cap the persisted JSON snapshot at ~256 KB


def _snapshot_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Bound the persisted result snapshot by both row count and byte size."""
    import json

    capped: list[dict[str, Any]] = []
    size = 0
    for row in rows[:_SNAPSHOT_MAX_ROWS]:
        size += len(json.dumps(row, default=str))
        if size > _SNAPSHOT_MAX_BYTES:
            break
        capped.append(row)
    return capped


async def process_nl_query(
    nl_query: str,
    datasource_id: str | None,
    user_id: str,
    db: AsyncSession,
    cache: CacheService,
) -> QueryResult:
    """Run the full pipeline and persist a query log.

    Identical questions on the same source return from cache (no AI/DB), while
    still recording a QueryLog so history and dashboards keep working.
    """
    started = time.perf_counter()
    key = _cache_key(datasource_id, nl_query)

    cached = await cache.get(key)
    if cached:
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        return await _finalize(
            db, user_id, datasource_id, nl_query,
            sql=cached["sql"],
            columns=cached["columns"],
            rows=cached["rows"],
            chart_config=ChartConfig(**cached["chart_config"]),
            insight=cached["insight"],
            elapsed_ms=elapsed_ms,
            from_cache=True,
        )

    if settings.DEMO_MODE and not datasource_id:
        sql_result, columns, rows, dialect = await _demo_pipeline(nl_query)
        resolved_ds_id: str | None = None
    else:
        sql_result, columns, rows, dialect = await _live_pipeline(
            nl_query, datasource_id, user_id, db, cache
        )
        resolved_ds_id = datasource_id

    # Chart selection and insight generation are independent — run concurrently.
    chart_config, insight = await asyncio.gather(
        select_chart_type(columns, rows, nl_query),
        generate_insight(rows, nl_query),
    )
    elapsed_ms = int((time.perf_counter() - started) * 1000)

    await cache.set(
        key,
        {
            "sql": sql_result.sql,
            "columns": columns,
            "rows": _snapshot_rows(rows),
            "chart_config": chart_config.model_dump(),
            "insight": insight,
        },
        ttl=settings.CACHE_TTL_SECONDS,
    )

    return await _finalize(
        db, user_id, resolved_ds_id, nl_query,
        sql=sql_result.sql,
        columns=columns,
        rows=rows,
        chart_config=chart_config,
        insight=insight,
        elapsed_ms=elapsed_ms,
        from_cache=False,
    )


async def _finalize(
    db: AsyncSession,
    user_id: str,
    datasource_id: str | None,
    nl_query: str,
    *,
    sql: str,
    columns: list[str],
    rows: list[dict[str, Any]],
    chart_config: ChartConfig,
    insight: str,
    elapsed_ms: int,
    from_cache: bool,
) -> QueryResult:
    """Persist a QueryLog and build the response (shared by cache hit + miss)."""
    log = QueryLog(
        user_id=user_id,
        datasource_id=datasource_id,
        natural_language=nl_query,
        generated_sql=sql,
        chart_type=chart_config.chart_type,
        chart_config=chart_config.model_dump(),
        result_data={"columns": columns, "rows": _snapshot_rows(rows)},
        insight=insight,
        execution_time_ms=elapsed_ms,
    )
    db.add(log)
    await db.flush()
    await db.refresh(log)

    return QueryResult(
        sql=sql,
        data=rows,
        columns=[ColumnInfo(name=c, type="unknown") for c in columns],
        chart_config=chart_config,
        insight=insight,
        execution_time_ms=elapsed_ms,
        query_log_id=log.id,
        from_cache=from_cache,
    )


async def _live_pipeline(
    nl_query: str,
    datasource_id: str | None,
    user_id: str,
    db: AsyncSession,
    cache: CacheService,
) -> tuple[Text2SQLResult, list[str], list[dict[str, Any]], str]:
    ds = await ds_service.get_datasource(db, user_id, datasource_id or "")
    schema = await ds_service.get_schema_cached(ds, cache)
    schema_text = ds_service.schema_as_prompt(schema)
    sql_result = await _engine.generate_sql(nl_query, schema_text, ds.db_type.value)
    columns, rows = await ds_service.execute_select(ds, sql_result.sql)
    return sql_result, columns, rows, ds.db_type.value


async def _demo_pipeline(
    nl_query: str,
) -> tuple[Text2SQLResult, list[str], list[dict[str, Any]], str]:
    # Demo executor is provided in Step 7.
    from app.db import demo_data

    schema_text = demo_data.format_demo_schema()
    sql_result = await _engine.generate_sql(nl_query, schema_text, "sqlite")
    columns, rows = demo_data.execute_demo_sql(sql_result.sql)
    return sql_result, columns, rows, "sqlite"
