"""Core orchestration: NL query -> SQL -> execute -> chart -> insight -> log."""
from __future__ import annotations

import asyncio
import hashlib
import time
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.chart_selector import select_chart_type
from app.ai.insight_generator import generate_insight
from app.ai.text2sql import Text2SQLEngine
from app.ai.types import ChartConfig, Text2SQLResult
from app.config import settings
from app.core.exceptions import AIGenerationError, NexusBIException
from app.core.logging import get_logger
from app.models.query_log import QueryLog
from app.schemas.query import ColumnInfo, QueryResult
from app.services import datasource_service as ds_service
from app.services import metric_service
from app.services.cache_service import CacheService


def _cache_key(datasource_id: str | None, nl_query: str, extra_context: str = "") -> str:
    raw = f"{nl_query.strip().lower()}|{extra_context}"
    h = hashlib.sha1(raw.encode()).hexdigest()
    return f"qcache:{datasource_id or 'demo'}:{h}"

_engine = Text2SQLEngine()
_log = get_logger("nexusbi.query")

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
    *,
    bypass_cache: bool = False,
    previous_query_log_id: str | None = None,
) -> QueryResult:
    """Run the full pipeline and persist a query log.

    Identical questions on the same source return from cache (no AI/DB), while
    still recording a QueryLog so history and dashboards keep working.
    ``bypass_cache`` forces a fresh run (used by widget refresh).
    """
    started = time.perf_counter()

    # Semantic layer: inject the user's metric definitions for this source.
    metrics = await metric_service.list_for(db, user_id, datasource_id)
    extra_context = metric_service.metrics_as_prompt(metrics)

    # Multi-turn: include the previous turn so follow-ups ("break it down by month") resolve.
    if previous_query_log_id:
        prev = await db.execute(
            select(QueryLog).where(
                QueryLog.id == previous_query_log_id, QueryLog.user_id == user_id
            )
        )
        prev_log = prev.scalar_one_or_none()
        if prev_log is not None:
            block = (
                "ƏVVƏLKİ SUAL (bu, davam sualıdır — kontekst kimi nəzərə al):\n"
                f"Sual: {prev_log.natural_language}\nSQL: {prev_log.generated_sql}"
            )
            extra_context = f"{extra_context}\n\n{block}" if extra_context else block

    key = _cache_key(datasource_id, nl_query, extra_context)

    cached = None if bypass_cache else await cache.get(key)
    if cached:
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        return await _finalize(
            db, user_id, datasource_id, nl_query,
            sql=cached["sql"],
            columns=cached["columns"],
            rows=cached["rows"],
            snapped=cached["rows"],  # cached rows are already snapshotted
            chart_config=ChartConfig(**cached["chart_config"]),
            insight=cached["insight"],
            elapsed_ms=elapsed_ms,
            from_cache=True,
        )

    if settings.DEMO_MODE and not datasource_id:
        sql_result, columns, rows = await _demo_pipeline(nl_query, extra_context)
        resolved_ds_id: str | None = None
    else:
        sql_result, columns, rows = await _live_pipeline(
            nl_query, datasource_id, user_id, db, cache, extra_context
        )
        resolved_ds_id = datasource_id

    # Chart selection and insight generation are independent — run concurrently.
    # return_exceptions keeps one failing path from sinking the whole query;
    # both already degrade internally, this is defense in depth.
    chart_config, insight = await asyncio.gather(
        select_chart_type(columns, rows, nl_query),
        generate_insight(rows, nl_query),
        return_exceptions=True,
    )
    if isinstance(chart_config, BaseException):
        _log.warning("chart_select_errored", error=str(chart_config)[:200])
        chart_config = ChartConfig(chart_type="table")
    if isinstance(insight, BaseException):
        _log.warning("insight_errored", error=str(insight)[:200])
        insight = ""
    elapsed_ms = int((time.perf_counter() - started) * 1000)

    # Snapshot once; reuse for both the cache payload and the persisted log.
    snapped = _snapshot_rows(rows)
    await cache.set(
        key,
        {
            "sql": sql_result.sql,
            "columns": columns,
            "rows": snapped,
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
        snapped=snapped,
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
    snapped: list[dict[str, Any]],
    chart_config: ChartConfig,
    insight: str,
    elapsed_ms: int,
    from_cache: bool,
) -> QueryResult:
    """Persist a QueryLog and build the response (shared by cache hit + miss).

    ``rows`` is the full result for the response; ``snapped`` is the bounded
    snapshot persisted to the log (already computed by the caller).
    """
    log = QueryLog(
        user_id=user_id,
        datasource_id=datasource_id,
        natural_language=nl_query,
        generated_sql=sql,
        chart_type=chart_config.chart_type,
        chart_config=chart_config.model_dump(),
        result_data={"columns": columns, "rows": snapped},
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
    extra_context: str = "",
) -> tuple[Text2SQLResult, list[str], list[dict[str, Any]]]:
    ds = await ds_service.get_datasource(db, user_id, datasource_id or "")
    schema = await ds_service.get_schema_cached(ds, cache)
    schema_text = ds_service.schema_as_prompt(schema)
    sql_result = await _engine.generate_sql(
        nl_query, schema_text, ds.db_type.value, extra_context
    )
    try:
        columns, rows = await ds_service.execute_select(ds, sql_result.sql)
    except NexusBIException as exc:
        # Surface the generated SQL so the user can see what failed.
        exc.sql = sql_result.sql
        raise
    return sql_result, columns, rows


async def _demo_pipeline(
    nl_query: str,
    extra_context: str = "",
) -> tuple[Text2SQLResult, list[str], list[dict[str, Any]]]:
    from app.ai import rule_based_sql
    from app.db import demo_data

    schema_text = demo_data.format_demo_schema()
    try:
        sql_result = await _engine.generate_sql(nl_query, schema_text, "sqlite", extra_context)
    except AIGenerationError as exc:
        # No working AI (missing/invalid key, rate limit) — keep the demo usable
        # with a deterministic, schema-aware SQL fallback.
        _log.warning("demo_ai_fallback", error=exc.message, detail=exc.detail)
        sql_result = rule_based_sql.generate_sql_fallback(nl_query)
    columns, rows = demo_data.execute_demo_sql(sql_result.sql)
    return sql_result, columns, rows
