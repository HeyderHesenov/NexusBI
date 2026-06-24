"""Core orchestration: NL query -> SQL -> execute -> chart -> insight -> log."""
from __future__ import annotations

import time
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.chart_selector import select_chart_type
from app.ai.insight_generator import generate_insight
from app.ai.text2sql import Text2SQLEngine
from app.ai.types import Text2SQLResult
from app.config import settings
from app.models.query_log import QueryLog
from app.schemas.query import ColumnInfo, QueryResult
from app.services import datasource_service as ds_service
from app.services.cache_service import CacheService

_engine = Text2SQLEngine()


async def process_nl_query(
    nl_query: str,
    datasource_id: str | None,
    user_id: str,
    db: AsyncSession,
    cache: CacheService,
) -> QueryResult:
    """Run the full pipeline and persist a query log."""
    started = time.perf_counter()

    if settings.DEMO_MODE and not datasource_id:
        sql_result, columns, rows, dialect = await _demo_pipeline(nl_query)
        resolved_ds_id: str | None = None
    else:
        sql_result, columns, rows, dialect = await _live_pipeline(
            nl_query, datasource_id, user_id, db, cache
        )
        resolved_ds_id = datasource_id

    chart_config = await select_chart_type(columns, rows, nl_query)
    insight = await generate_insight(rows, nl_query, chart_config)
    elapsed_ms = int((time.perf_counter() - started) * 1000)

    log = QueryLog(
        user_id=user_id,
        datasource_id=resolved_ds_id,
        natural_language=nl_query,
        generated_sql=sql_result.sql,
        chart_type=chart_config.chart_type,
        chart_config=chart_config.model_dump(),
        result_data={"columns": columns, "rows": rows[:1000]},
        insight=insight,
        execution_time_ms=elapsed_ms,
    )
    db.add(log)
    await db.flush()
    await db.refresh(log)

    return QueryResult(
        sql=sql_result.sql,
        data=rows,
        columns=[ColumnInfo(name=c, type="unknown") for c in columns],
        chart_config=chart_config,
        insight=insight,
        execution_time_ms=elapsed_ms,
        query_log_id=log.id,
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
