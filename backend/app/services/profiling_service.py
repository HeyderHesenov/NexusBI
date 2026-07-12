"""Data profiling: per-column stats (null %, distinct, min/max, type) for a table.

Sample-based (bounded SELECT) so it's DB-agnostic and cheap; results are cached.
"""
from __future__ import annotations

import numbers
from typing import Any

from app.core.exceptions import SchemaNotFoundError
from app.models.datasource import DataSource, DBType
from app.services import datasource_service
from app.services.cache_service import CacheService

_SAMPLE = 1000


def _is_number(v: Any) -> bool:
    # numbers.Number covers Decimal (Postgres NUMERIC) too; exclude bools.
    return isinstance(v, numbers.Number) and not isinstance(v, bool)


def _profile_rows(columns: list[str], rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    n = len(rows)
    out: list[dict[str, Any]] = []
    for col in columns:
        values = [r.get(col) for r in rows]
        non_null = [v for v in values if v is not None]
        nums = [float(v) for v in non_null if _is_number(v)]
        numeric = bool(nums) and len(nums) >= max(1, len(non_null) // 2)
        out.append(
            {
                "column": col,
                "dtype": "number" if numeric else ("empty" if not non_null else "text"),
                "null_pct": round((n - len(non_null)) / n * 100, 1) if n else 0.0,
                "distinct": len({str(v) for v in non_null}),
                "min": min(nums) if nums else None,
                "max": max(nums) if nums else None,
                "sample_size": n,
            }
        )
    return out


async def profile(
    db, user_id: str, datasource_id: str, table: str, cache: CacheService
) -> dict[str, Any]:
    """Profile a table of an owned or shared-to-me datasource (≤1000-row sample)."""
    # Read-only: owner OR a workspace member the source is shared with.
    ds: DataSource = await datasource_service.get_datasource_for_user(db, user_id, datasource_id)
    if ds.db_type == DBType.powerbi:
        raise SchemaNotFoundError("Power BI mənbələri profilləşdirilmir.")

    # Validate the table name against the real schema — never interpolate raw input.
    schema = await datasource_service.get_schema_cached(ds, cache)
    if table not in schema:
        raise SchemaNotFoundError("Cədvəl tapılmadı.")

    cache_key = f"profile:{ds.id}:{table}"
    cached = await cache.get(cache_key)
    if cached:
        return cached

    sql = f'SELECT * FROM "{table}" LIMIT {_SAMPLE}'
    columns, rows = await datasource_service.execute_select(ds, sql)
    result = {"table": table, "row_sample": len(rows), "columns": _profile_rows(columns, rows)}
    await cache.set(cache_key, result, ttl=600)
    return result
