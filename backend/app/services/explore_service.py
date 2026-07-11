"""One-click Explore: profile a source and assemble a deterministic X-ray dashboard.

No AI anywhere — composes guarded analytic SELECTs (KPI totals, time series, top-N
breakdowns, distributions) from the source's own schema and runs them through the
AI-free ``run_user_sql`` path. This is the ONLY dashboard-generation path that works
fully offline / in demo mode: the AI planner (``dashboard_planner``) is LLM-only and
raises with an empty AI key.
"""
from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.ai import sql_guard
from app.core.exceptions import DataSourceConnectionError, SchemaNotFoundError
from app.core.logging import get_logger
from app.db import demo_data
from app.models.dashboard import Dashboard
from app.models.datasource import DBType
from app.services import dashboard_service
from app.services import datasource_service as ds_service
from app.services import query_service
from app.services.cache_service import CacheService
from app.services.tabular import numeric_columns

_log = get_logger("nexusbi.explore")

_SAMPLE_ROWS = 200
_MAX_WIDGETS = 8
_TOP_N = 10
# Substrings that mark a column as a time axis (incl. az "tarix" = date).
_TEMPORAL_HINTS = ("date", "time", "year", "month", "day", "_at", "tarix")


def _is_id_like(col: str) -> bool:
    """Key/id columns are numeric but meaningless to SUM — keep them out of measures.

    Match the real id-naming conventions (``id``, ``user_id``, ``userId``, ``USERID``)
    without the fragile bare ``endswith("id")`` that also swallowed genuine measures
    like ``paid``, ``bid``, ``grid`` or ``valid``.
    """
    c = col.lower()
    return c == "id" or c.endswith("_id") or col.endswith(("Id", "ID"))


def _is_temporal(col: str) -> bool:
    c = col.lower()
    return any(h in c for h in _TEMPORAL_HINTS)


def _classify(
    columns: list[str], rows: list[dict[str, Any]]
) -> tuple[list[str], list[str], list[str]]:
    """Split columns into (measures, dimensions, temporals) from a value sample."""
    numeric = set(numeric_columns(columns, rows))
    measures = [
        c for c in columns if c in numeric and not _is_id_like(c) and not _is_temporal(c)
    ]
    temporals = [c for c in columns if _is_temporal(c)]
    dims = [
        c
        for c in columns
        if c not in numeric and c not in temporals and not _is_id_like(c)
    ]
    return measures, dims, temporals


def _q(ident: str, dialect: str) -> str:
    """Quote a schema identifier for ``dialect`` (schema-sourced, never free text).

    MySQL uses backtick identifiers — its default sql_mode reads ``"x"`` as a string
    literal, so double-quoting there would silently break every composed query.
    """
    if dialect == "mysql":
        return "`" + ident.replace("`", "``") + "`"
    return '"' + ident.replace('"', '""') + '"'


def _compose_queries(
    table: str,
    measures: list[str],
    dims: list[str],
    temporals: list[str],
    dialect: str,
) -> list[tuple[str, str]]:
    """Deterministic ``(title, SQL)`` analytic queries for one table (az titles)."""
    def q(ident: str) -> str:
        return _q(ident, dialect)

    t = q(table)
    say = q("say")
    out: list[tuple[str, str]] = []

    # KPI totals for up to 2 measures.
    for m in measures[:2]:
        out.append((f"{m} — cəmi", f"SELECT SUM({q(m)}) AS {q(m)} FROM {t}"))

    m0 = measures[0] if measures else None

    # Time series of the top measure over the first temporal column.
    if m0 and temporals:
        ts = temporals[0]
        out.append(
            (
                f"{ts} üzrə {m0}",
                f"SELECT {q(ts)}, SUM({q(m0)}) AS {q(m0)} FROM {t} "
                f"GROUP BY {q(ts)} ORDER BY {q(ts)} LIMIT 100",
            )
        )

    # Top measure broken down by up to 2 dimensions.
    if m0:
        for d in dims[:2]:
            out.append(
                (
                    f"{d} üzrə {m0}",
                    f"SELECT {q(d)}, SUM({q(m0)}) AS {q(m0)} FROM {t} "
                    f"GROUP BY {q(d)} ORDER BY SUM({q(m0)}) DESC LIMIT {_TOP_N}",
                )
            )

    # Row counts by the top dimension (works even with no numeric measure).
    if dims:
        d0 = dims[0]
        out.append(
            (
                f"{d0} üzrə say",
                f"SELECT {q(d0)}, COUNT(*) AS {say} FROM {t} "
                f"GROUP BY {q(d0)} ORDER BY COUNT(*) DESC LIMIT {_TOP_N}",
            )
        )

    return out[:_MAX_WIDGETS]


async def _resolve_tables(
    db: AsyncSession, user_id: str, datasource_id: str | None, cache: CacheService
) -> tuple[dict[str, list[str]], str, str]:
    """Return ``({table: [columns]}, source_name, dialect)`` for demo or a real source."""
    if datasource_id is None:
        # Demo model is served from an in-process sqlite engine.
        return {t: list(cols) for t, cols in demo_data.DEMO_SCHEMA.items()}, "Demo", "sqlite"
    ds = await ds_service.get_datasource(db, user_id, datasource_id)
    if ds.db_type == DBType.powerbi:
        raise DataSourceConnectionError("Power BI mənbələri avtomatik kəşf dəstəkləmir.")
    schema = await ds_service.get_schema_cached(ds, cache)
    tables = {t: [c["name"] for c in cols] for t, cols in schema.items()}
    return tables, ds.name, ds.db_type.value


async def build_explore_dashboard(
    db: AsyncSession,
    user_id: str,
    datasource_id: str | None,
    cache: CacheService,
) -> Dashboard:
    """Profile the source's largest table and assemble a deterministic dashboard."""
    tables, source_name, dialect = await _resolve_tables(db, user_id, datasource_id, cache)
    if not tables:
        raise SchemaNotFoundError("Kəşf üçün cədvəl tapılmadı.")

    # The widest table is the richest to explore (most measures/dimensions).
    table = max(tables, key=lambda t: len(tables[t]))
    columns = tables[table]

    # Sample the table (guarded, NOT persisted) to classify columns by real values.
    sample_cols, sample_rows = columns, []
    try:
        clean = sql_guard.validate_select_only(
            f"SELECT * FROM {_q(table, dialect)} LIMIT {_SAMPLE_ROWS}"
        )
        sample_cols, sample_rows = await query_service.guarded_read(
            clean, datasource_id, user_id, db, cache
        )
    except Exception as exc:  # noqa: BLE001 — fall back to schema column names
        _log.warning("explore_sample_failed", table=table, error=str(exc)[:200])

    measures, dims, temporals = _classify(sample_cols or columns, sample_rows)
    queries = _compose_queries(table, measures, dims, temporals, dialect)
    if not queries:
        raise SchemaNotFoundError("Bu mənbədən avtomatik qrafik yaradıla bilmədi.")

    # Run each composed query through the AI-free path (persists a QueryLog each).
    # One failing widget must not sink the whole board.
    items: list[tuple[str, str]] = []
    for title, sql in queries:
        try:
            result = await query_service.run_user_sql(
                sql, datasource_id, title, user_id, db, cache
            )
        except Exception as exc:  # noqa: BLE001
            _log.warning("explore_query_failed", title=title, error=str(exc)[:200])
            continue
        if result.query_log_id and result.data:
            items.append((title, result.query_log_id))

    if not items:
        raise SchemaNotFoundError("Kəşf nəticə vermədi.")

    dash = await dashboard_service.create_dashboard(
        db, user_id, f"{source_name} — kəşf", f"Avtomatik kəşf: {source_name}"
    )
    return await dashboard_service.layout_widgets(db, user_id, dash, items)
