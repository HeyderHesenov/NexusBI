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
from app.ai import sql_guard
from app.ai.text2dax import Text2DAXEngine
from app.ai.text2sql import Text2SQLEngine
from app.ai.types import ChartConfig, Text2SQLResult
from app.config import settings
from app.core.exceptions import AIGenerationError, NexusBIException
from app.core.logging import get_logger
from app.models.datasource import DBType
from app.models.query_log import QueryLog
from app.schemas.query import ColumnInfo, QueryResult
from app.services import datasource_service as ds_service
from app.services import metric_service
from app.services.cache_service import CacheService, build_cache_service


def _cache_key(
    datasource_id: str | None, nl_query: str, user_id: str, extra_context: str = ""
) -> str:
    # User-scoped: two users can have different metrics AND different row-level
    # security rules, so a shared cache key could leak RLS-filtered rows.
    raw = f"{user_id}|{nl_query.strip().lower()}|{extra_context}"
    h = hashlib.sha1(raw.encode()).hexdigest()
    return f"qcache:{datasource_id or 'demo'}:{h}"

_engine = Text2SQLEngine()
_dax_engine = Text2DAXEngine()
_log = get_logger("nexusbi.query")


def _sqlgen_key(schema_text: str, dialect: str, extra_context: str, nl_query: str) -> str:
    """Schema-scoped (user-INDEPENDENT) cache key for NL→SQL generation.

    Safe to share across users: RLS is injected AFTER generation, so the cached
    SQL carries no per-user data. Cuts repeated gpt-4o spend (incl. the 3-attempt
    retry) for identical questions over the same schema/metric context.
    """
    raw = f"{dialect}|{schema_text}|{extra_context}|{nl_query.strip().lower()}"
    return f"sqlgen:{hashlib.sha1(raw.encode()).hexdigest()}"


async def _generate_sql_cached(
    nl_query: str,
    schema_text: str,
    dialect: str,
    extra_context: str,
    cache: CacheService,
) -> Text2SQLResult:
    key = _sqlgen_key(schema_text, dialect, extra_context, nl_query)
    cached = await cache.get(key)
    if cached:
        return Text2SQLResult(**cached)
    result = await _engine.generate_sql(nl_query, schema_text, dialect, extra_context)
    # Only validated SQL reaches here (generate_sql runs validate_select_only).
    await cache.set(key, result.model_dump(), ttl=settings.SQLGEN_CACHE_TTL_SECONDS)
    return result

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

    key = _cache_key(datasource_id, nl_query, user_id, extra_context)

    cached = None if bypass_cache else await cache.get(key)
    if cached:
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        return await _finalize(
            db, user_id, datasource_id, nl_query,
            sql=cached["sql"],
            query_language=cached.get("query_language", "sql"),
            columns=cached["columns"],
            rows=cached["rows"],
            snapped=cached["rows"],  # cached rows are already snapshotted
            chart_config=ChartConfig(**cached["chart_config"]),
            insight=cached["insight"],
            elapsed_ms=elapsed_ms,
            from_cache=True,
        )

    if settings.DEMO_MODE and not datasource_id:
        query_text, columns, rows = await _demo_pipeline(nl_query, extra_context)
        resolved_ds_id: str | None = None
        query_language = "sql"
    else:
        query_text, columns, rows, query_language = await _live_pipeline(
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
            "sql": query_text,
            "query_language": query_language,
            "columns": columns,
            "rows": snapped,
            "chart_config": chart_config.model_dump(),
            "insight": insight,
        },
        ttl=settings.CACHE_TTL_SECONDS,
    )

    return await _finalize(
        db, user_id, resolved_ds_id, nl_query,
        sql=query_text,
        query_language=query_language,
        columns=columns,
        rows=rows,
        snapped=snapped,
        chart_config=chart_config,
        insight=insight,
        elapsed_ms=elapsed_ms,
        from_cache=False,
    )


async def reexecute_logged_query(
    log: QueryLog, db: AsyncSession, user_id: str, cache: CacheService | None = None
) -> tuple[list[str], list[dict[str, Any]]]:
    """Re-run a query log's stored SQL and return fresh (columns, rows) — NO AI.

    Used by live dashboards to refresh data cheaply on a short interval: the
    chart type and insight are reused, only the underlying numbers change.
    Power BI (DAX) sources are not supported here.
    """
    if not log.generated_sql:
        raise ValueError("query log has no SQL to re-run")
    if log.datasource_id is None:
        from app.db import demo_data

        return demo_data.execute_demo_sql(log.generated_sql)
    ds = await ds_service.get_datasource(db, user_id, log.datasource_id)
    if ds.db_type == DBType.powerbi:
        raise ValueError("live refresh unsupported for Power BI")
    from app.services import rls_service, rls_sql

    # Re-introspect the schema once: needed for both the table allowlist and RLS.
    own_cache = cache or await build_cache_service()
    try:
        schema = await ds_service.get_schema_cached(ds, own_cache)
    finally:
        if cache is None:  # close only the transient client we created here
            await own_cache.aclose()
    # Allowlist on the re-run path too — stored SQL must not read tables outside
    # the current schema (e.g. rows written before the allowlist existed).
    sql_guard.assert_tables_in_schema(log.generated_sql, list(schema.keys()), ds.db_type.value)
    # Row-level security: constrain the stored SQL for this viewer (SQL-level,
    # correct for aggregates) before re-running.
    exec_sql = log.generated_sql
    rules = await rls_service.rules_for_user(db, ds.id, user_id)
    if rules:
        exec_sql = rls_sql.constrain_sql(exec_sql, rules, schema, ds.db_type.value)
    columns, rows = await ds_service.execute_select(ds, exec_sql)
    return columns, rows


async def _finalize(
    db: AsyncSession,
    user_id: str,
    datasource_id: str | None,
    nl_query: str,
    *,
    sql: str,
    query_language: str = "sql",
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
        query_language=query_language,
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
) -> tuple[str, list[str], list[dict[str, Any]], str]:
    ds = await ds_service.get_datasource(db, user_id, datasource_id or "")
    if ds.db_type == DBType.powerbi:
        return await _powerbi_pipeline(nl_query, ds, cache, extra_context)
    schema = await ds_service.get_schema_cached(ds, cache)
    schema_text = ds_service.schema_as_prompt(schema)
    sql_result = await _generate_sql_cached(
        nl_query, schema_text, ds.db_type.value, extra_context, cache
    )
    # Allowlist: the generated query may only read tables this datasource exposes
    # (blocks metadata/catalog exfil and any hallucinated cross-DB table).
    sql_guard.assert_tables_in_schema(sql_result.sql, list(schema.keys()), ds.db_type.value)
    # Row-level security: rewrite the SQL so each protected table is row-filtered
    # BEFORE aggregation (post-fetch filtering leaks SUM/GROUP BY totals). The
    # original (unconstrained) SQL is what we persist/show — RLS is per-viewer and
    # re-applied on every execution, not baked into the stored query.
    from app.services import rls_service, rls_sql

    rules = await rls_service.rules_for_user(db, ds.id, user_id)
    exec_sql = sql_result.sql
    if rules:
        exec_sql = rls_sql.constrain_sql(exec_sql, rules, schema, ds.db_type.value)
    try:
        columns, rows = await ds_service.execute_select(ds, exec_sql)
    except NexusBIException as exc:
        # Surface the AI-generated SQL so the user can see what failed.
        exc.sql = sql_result.sql
        raise
    return sql_result.sql, columns, rows, "sql"


def _dax_schema_text(schema: dict[str, Any]) -> str:
    """Render a Power BI model schema dict for the NL->DAX prompt."""
    lines: list[str] = []
    for table, cols in schema.items():
        names = ", ".join(c["name"] for c in cols)
        nums = ", ".join(c["name"] for c in cols if c.get("type") == "NUMERIC")
        lines.append(f"- Table '{table}': columns [{names}] | numeric (measures): [{nums}]")
    return "\n".join(lines)


async def _powerbi_pipeline(
    nl_query: str,
    ds: Any,
    cache: CacheService,
    extra_context: str = "",
) -> tuple[str, list[str], list[dict[str, Any]], str]:
    """Power BI path: NL -> DAX -> provider.execute_dax. Mirrors the SQL path."""
    from app.ai import rule_based_dax
    from app.services.powerbi.provider import get_provider

    cfg = ds_service.powerbi_config(ds)
    dataset_id = cfg["dataset_id"]
    schema = await ds_service.get_schema_cached(ds, cache)
    schema_text = _dax_schema_text(schema)
    try:
        dax_result = await _dax_engine.generate_dax(nl_query, schema_text, extra_context)
    except AIGenerationError as exc:
        # No working AI — keep Power BI demo usable with a deterministic DAX fallback.
        _log.warning("powerbi_dax_fallback", error=exc.message, detail=exc.detail)
        dax_result = rule_based_dax.generate_dax_fallback(nl_query)
    columns, rows = await get_provider().execute_dax(dataset_id, dax_result.dax)
    return dax_result.dax, columns, rows, "dax"


async def _demo_pipeline(
    nl_query: str,
    extra_context: str = "",
) -> tuple[str, list[str], list[dict[str, Any]]]:
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
    return sql_result.sql, columns, rows
