"""Cohort retention and funnel analytics.

Two modes share one compute core:
- **Demo** (no datasource): deterministic SELECTs against a freshly seeded
  snapshot (``execute_demo_snapshot``) — the original behaviour, kept for the
  copilot tools and the no-config page load.
- **Real data**: the user maps columns on their own datasource; rows are
  fetched through the SAME guard chain as /query (table allowlist + per-viewer
  RLS, fail-closed) via ``query_service._guarded_execute`` and fed into the
  identical retention-matrix / funnel math.

The math (``retention_from_rows`` / ``funnel_from_counts``) is pure and data
source agnostic — only the fetch differs.
"""
from __future__ import annotations

import asyncio
import re
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import InvalidSQLError, NexusBIException
from app.db.demo_data import FUNNEL_EVENT_STEPS, execute_demo_snapshot
from app.services import datasource_service

_TABLE_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,254}$")
MAX_COHORT_ROWS = 10000  # execute_select caps live results here anyway

_ACTIVITY_SQL = (
    "SELECT customer_id, substr(event_date, 1, 7) AS month"
    " FROM events GROUP BY customer_id, month"
)
_FUNNEL_SQL = (
    "SELECT event_type, COUNT(DISTINCT customer_id) AS customers"
    " FROM events GROUP BY event_type"
)


# --------------------------------------------------------------------------- #
# Pure compute — no I/O, unit-testable                                         #
# --------------------------------------------------------------------------- #
def _month_index(month: str) -> int:
    """'2024-03' → absolute month number (year*12 + month-1)."""
    year, mon = month.split("-")
    return int(year) * 12 + int(mon) - 1


def _is_month(value: str) -> bool:
    """A 'YYYY-MM…' prefix we can bucket a cohort by."""
    return len(value) >= 7 and value[4] == "-" and value[:4].isdigit() and value[5:7].isdigit()


def retention_from_rows(
    rows: list[dict[str, Any]], entity_col: str, date_col: str
) -> dict[str, Any]:
    """Cohort retention matrix from raw (entity, date) rows.

    Cohort = the month of an entity's first event; the entity counts as
    retained at offset *k* if it has any event in cohort-month + k. Cells
    beyond the observed calendar are ``None`` (unknowable), inside but inactive
    are 0. Rows with a missing entity or an unparseable date are skipped.
    """
    label_of: dict[int, str] = {}
    months_by_entity: dict[Any, set[int]] = {}
    for row in rows:
        entity = row.get(entity_col)
        raw = row.get(date_col)
        if entity is None or raw is None:
            continue
        month = str(raw)[:7]
        if not _is_month(month):
            continue
        idx = _month_index(month)
        label_of[idx] = month
        months_by_entity.setdefault(entity, set()).add(idx)

    if not months_by_entity:
        return {"cohorts": [], "offsets": [], "sizes": [], "cells": []}

    last_month = max(label_of)
    members_by_cohort: dict[int, list[Any]] = {}
    for eid, months in months_by_entity.items():
        members_by_cohort.setdefault(min(months), []).append(eid)
    cohort_months = sorted(members_by_cohort)
    offsets = list(range(max(last_month - cm for cm in cohort_months) + 1))

    cells: list[list[dict[str, Any] | None]] = []
    for cm in cohort_months:
        members = members_by_cohort[cm]
        row_cells: list[dict[str, Any] | None] = []
        for k in offsets:
            if cm + k > last_month:
                row_cells.append(None)  # beyond the observed calendar
                continue
            active = sum(1 for eid in members if cm + k in months_by_entity[eid])
            row_cells.append({"count": active, "pct": round(active / len(members) * 100, 1)})
        cells.append(row_cells)

    return {
        "cohorts": [label_of[cm] for cm in cohort_months],
        "offsets": offsets,
        "sizes": [len(members_by_cohort[cm]) for cm in cohort_months],
        "cells": cells,
    }


def funnel_from_counts(counts: dict[str, int], order: list[str]) -> dict[str, Any]:
    """Funnel steps (count, pct-of-first, drop-off) for the given stage order."""
    steps: list[dict[str, Any]] = []
    first = counts.get(order[0], 0) if order else 0
    prev: int | None = None
    for name in order:
        count = counts.get(name, 0)
        pct_of_first = round(count / first * 100, 1) if first else 0.0
        # A later step can't logically exceed its predecessor; clamp defensively
        # so odd data yields 0.0 instead of a negative "−-X%" label.
        drop_pct = round(max(prev - count, 0) / prev * 100, 1) if prev else 0.0
        steps.append(
            {"name": name, "count": count, "pct_of_first": pct_of_first, "drop_pct": drop_pct}
        )
        prev = count
    return {"steps": steps}


# --------------------------------------------------------------------------- #
# Demo fetch — original deterministic behaviour (used by copilot + no-config)  #
# --------------------------------------------------------------------------- #
def _demo_rows(sql: str) -> list[dict[str, Any]]:
    """Run one demo SELECT; a failed query is an error, NOT an empty dataset."""
    (rows,) = execute_demo_snapshot([sql])
    if rows is None:
        raise InvalidSQLError("Kohort sorğusu icra olunmadı.")
    return rows


def retention_demo() -> dict[str, Any]:
    return retention_from_rows(_demo_rows(_ACTIVITY_SQL), "customer_id", "month")


def funnel_demo() -> dict[str, Any]:
    rows = _demo_rows(_FUNNEL_SQL)
    counts = {row["event_type"]: row["customers"] for row in rows}
    return funnel_from_counts(counts, list(FUNNEL_EVENT_STEPS))


# --------------------------------------------------------------------------- #
# Real-data fetch — reuses the /query guard chain (allowlist + RLS)            #
# --------------------------------------------------------------------------- #
def _safe_columns(
    table: str, wanted: list[str], allowed: set[str]
) -> None:
    """Validate the table name and that every mapped column exists — chosen
    columns are interpolated as SQL identifiers, so they must be whitelisted."""
    if not _TABLE_RE.match(table or ""):
        raise NexusBIException("Yanlış cədvəl adı.")
    for col in wanted:
        if not col or col not in allowed:
            raise NexusBIException(f"Sütun tapılmadı: {col!r}.")


async def _fetch_live(
    db: AsyncSession, cache: Any, user_id: str, datasource_id: str, table: str,
    wanted: list[str], sql: str,
) -> list[dict[str, Any]]:
    from app.services import query_service

    ds = await datasource_service.get_datasource(db, user_id, datasource_id)
    schema = await datasource_service.get_schema_cached(ds, cache)
    cols = schema.get(table)
    if cols is None:
        raise NexusBIException(f"Cədvəl tapılmadı: {table!r}.")
    _safe_columns(table, wanted, {c["name"] for c in cols})
    _, rows = await query_service._guarded_execute(ds, sql, schema, db, user_id)
    return rows


_EMPTY_RETENTION = {"cohorts": [], "offsets": [], "sizes": [], "cells": []}


async def retention(
    db: AsyncSession, cache: Any, user_id: str,
    datasource_id: str | None, table: str | None, entity_col: str | None, date_col: str | None,
) -> dict[str, Any]:
    """Retention for a mapped datasource. No datasource → demo snapshot; a
    datasource with an incomplete mapping → empty (never a demo/real mix)."""
    if datasource_id is None:
        return await asyncio.to_thread(retention_demo)
    if not (table and entity_col and date_col):
        return dict(_EMPTY_RETENTION)
    # DISTINCT (entity, date) mirrors the demo's pre-aggregation so we stay well
    # under the row cap; without it a raw LIMIT would truncate an entity's
    # earliest event and mis-assign its cohort.
    sql = (
        f'SELECT DISTINCT "{entity_col}" AS entity_v, "{date_col}" AS date_v'
        f' FROM "{table}" LIMIT {MAX_COHORT_ROWS}'
    )
    rows = await _fetch_live(db, cache, user_id, datasource_id, table, [entity_col, date_col], sql)
    if len(rows) >= MAX_COHORT_ROWS:
        raise NexusBIException("Cədvəl kohort analizi üçün çox böyükdür — əvvəlcə aqreqasiya edin.")
    data = retention_from_rows(rows, "entity_v", "date_v")
    if rows and not data["cohorts"]:
        raise NexusBIException("Tarix sütunu tanınmadı — YYYY-MM-DD formatlı sütun seçin.")
    return data


async def funnel(
    db: AsyncSession, cache: Any, user_id: str,
    datasource_id: str | None, table: str | None, entity_col: str | None, stage_col: str | None,
) -> dict[str, Any]:
    """Funnel for a mapped datasource (stages ordered by descending distinct
    count — the natural funnel). No datasource → demo; incomplete mapping → empty."""
    if datasource_id is None:
        return await asyncio.to_thread(funnel_demo)
    if not (table and entity_col and stage_col):
        return {"steps": []}
    sql = (
        f'SELECT "{stage_col}" AS stage, COUNT(DISTINCT "{entity_col}") AS c'
        f' FROM "{table}" GROUP BY "{stage_col}" LIMIT {MAX_COHORT_ROWS}'
    )
    rows = await _fetch_live(db, cache, user_id, datasource_id, table, [entity_col, stage_col], sql)
    counts = {str(row["stage"]): int(row["c"]) for row in rows if row.get("stage") is not None}
    order = sorted(counts, key=lambda k: counts[k], reverse=True)
    return funnel_from_counts(counts, order)
