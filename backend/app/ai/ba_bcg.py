"""BCG portfolio matrix — deterministic core, demo and live-source paths.

The matrix IS the artifact here: unlike the fact pack (which decorates a
framework and may be empty), BCG numbers cannot fail soft. If a chosen source
cannot be profiled we raise, rather than quietly drawing synthetic demo revenue
under the user's source name.

The half-over-half split is taken by RANK, not by calendar. ``substr(date,6,2)``
only worked because the demo's ``sale_date`` is TEXT; ``DATE_TRUNC`` / ``EXTRACT``
/ ``STRFTIME`` all diverge across sqlite/postgres/mysql, and parsing dates in
Python means handling ``str | date | datetime``. Sorting the distinct period keys
and cutting at ``len // 2`` is dialect-free, granularity-agnostic, and on the demo
seed (12 month keys) reproduces the calendar H1/H2 exactly.
"""
from __future__ import annotations

import asyncio
from typing import Any

from sqlglot import exp
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai import sql_guard
from app.config import settings
from app.core.exceptions import NexusBIException
from app.db.demo_data import execute_demo_snapshot
from app.services import query_service, stats
from app.services.cache_service import CacheService
from app.services.explore_service import profile_source, quote_ident

_GLOT_DIALECTS = {"postgresql": "postgres", "mysql": "mysql", "sqlite": "sqlite"}
_MAX_DIMS = 8  # portfolio rows kept — a matrix with 50 bubbles reads as noise
_MAX_ROWS = 5000  # cross-tab guard: _MAX_DIMS × periods


def _quadrant(high_share: bool, high_growth: bool) -> str:
    if high_share and high_growth:
        return "star"
    if high_share:
        return "cash_cow"
    if high_growth:
        return "question"
    return "dog"


def _median(values: list[float]) -> float:
    n = len(values)
    if not n:
        return 0.0
    mid = n // 2
    return values[mid] if n % 2 else (values[mid - 1] + values[mid]) / 2


def bcg_core_from_rows(
    rows: list[dict[str, Any]], dim_key: str, period_key: str, value_key: str
) -> dict[str, Any]:
    """Build the matrix from a ``dim × period`` cross-tab.

    share = the dim's share of the grand total. growth = the second half of the
    observed window against the first half; period keys are sorted as text
    ('/' normalised to '-' so "2024/03" doesn't sort after "2024-11") and cut at
    ``len // 2``, so an odd period count puts the middle period in the second half.
    Thresholds: share ≥ median share → high; growth > 0 → high.
    """
    per_dim: dict[str, dict[str, float]] = {}
    periods: set[str] = set()
    for r in rows:
        value = stats.to_float(r.get(value_key))
        if value is None:
            continue
        dim = str(r.get(dim_key))
        period = str(r.get(period_key) or "").replace("/", "-")
        periods.add(period)
        by_period = per_dim.setdefault(dim, {})
        by_period[period] = by_period.get(period, 0.0) + value

    keys = sorted(periods)
    cut = len(keys) // 2
    first, second = set(keys[:cut]), set(keys[cut:])

    items: list[dict[str, Any]] = []
    totals = {d: sum(bp.values()) for d, bp in per_dim.items()}
    grand = sum(totals.values()) or 1.0
    for dim, by_period in per_dim.items():
        h1 = sum(v for k, v in by_period.items() if k in first)
        h2 = sum(v for k, v in by_period.items() if k in second)
        if len(keys) < 2:
            # One period: growth is genuinely unknowable, so call it flat rather
            # than reading the single bucket as infinite growth.
            growth = 0.0
        elif h1:
            growth = (h2 - h1) / h1 * 100
        else:
            # h1 == 0 with h2 > 0 is a line that LAUNCHED in the second half — the
            # fastest grower there is, not a flat one. Cap it at +100% instead of ∞.
            growth = 100.0 if h2 > 0 else 0.0
        items.append({
            "label": dim,
            "share_pct": round(totals[dim] / grand * 100, 1),
            "growth_pct": round(growth, 1),
        })

    items.sort(key=lambda i: -i["share_pct"])
    share_thr = _median(sorted(i["share_pct"] for i in items))
    for i in items:
        i["quadrant"] = _quadrant(i["share_pct"] >= share_thr, i["growth_pct"] > 0)
    return {
        "items": items,
        "thresholds": {"share_pct": round(share_thr, 1), "growth_pct": 0.0},
    }


# ─── demo path ───

_DEMO_BCG_SQL = """
SELECT category, sale_date, SUM(revenue) AS measure
FROM sales GROUP BY category, sale_date
""".strip()


def compute_bcg() -> dict[str, Any]:
    """The demo portfolio matrix, off ONE seeded snapshot (single seed per call)."""
    rows = execute_demo_snapshot([_DEMO_BCG_SQL])[0] or []
    core = bcg_core_from_rows(rows, "category", "sale_date", "measure")
    core["source_name"] = "Demo"
    core["metric"] = "revenue"
    return core


# ─── live-source path ───

def _in_list(values: list[str], dialect: str) -> str:
    """``'a', 'b'`` with quotes escaped by sqlglot — never string-concatenated.

    Mirrors ``rls_sql._in_predicate``: dimension values are DATA read out of the
    user's table, so they must go through a literal builder, not an f-string.
    """
    glot = _GLOT_DIALECTS.get(dialect, "sqlite")
    return ", ".join(exp.Literal.string(v).sql(dialect=glot) for v in values)


async def compute_bcg_for_source(
    db: AsyncSession, user_id: str, datasource_id: str, cache: CacheService
) -> dict[str, Any]:
    """The portfolio matrix over a connected source.

    Raises rather than falling back to demo data: the user picked this source, and
    labelling synthetic revenue with their source name would be a lie about where
    the numbers came from.
    """
    p = await profile_source(db, user_id, datasource_id, cache)
    if not (p.measures and p.dims and p.temporals):
        raise NexusBIException(
            "Seçilmiş mənbədən portfel matrisi qurulmadı: ölçü, kateqoriya və "
            "tarix sütunu tələb olunur."
        )

    def q(ident: str) -> str:
        return quote_ident(ident, p.dialect)

    measure, dim, period = p.measures[0], p.dims[0], p.temporals[0]
    table = q(p.table)

    # Pick the portfolio rows first, then cross-tab only those. Truncating the
    # cross-tab itself would bias growth: ORDER BY SUM DESC keeps a dim's big
    # periods and drops its small ones, and ORDER BY dim, period drops the
    # highest-revenue dims alphabetically.
    top_sql = sql_guard.validate_select_only(
        f"SELECT {q(dim)} FROM {table} GROUP BY {q(dim)} "
        f"ORDER BY SUM({q(measure)}) DESC LIMIT {_MAX_DIMS}"
    )
    _, top_rows = await query_service.guarded_read(top_sql, datasource_id, user_id, db, cache)
    names = [str(r[dim]) for r in top_rows if r.get(dim) is not None]
    if not names:
        raise NexusBIException("Seçilmiş mənbədə portfel üçün kateqoriya tapılmadı.")

    grid_sql = sql_guard.validate_select_only(
        f"SELECT {q(dim)}, {q(period)}, SUM({q(measure)}) AS measure FROM {table} "
        f"WHERE {q(dim)} IN ({_in_list(names, p.dialect)}) "
        f"GROUP BY {q(dim)}, {q(period)} LIMIT {_MAX_ROWS}"
    )
    _, rows = await query_service.guarded_read(grid_sql, datasource_id, user_id, db, cache)
    core = bcg_core_from_rows(rows, dim, period, "measure")
    if not core["items"]:
        raise NexusBIException("Seçilmiş mənbədən portfel matrisi qurulmadı: rəqəm tapılmadı.")
    core["source_name"] = p.source_name
    core["metric"] = measure
    return core


async def compute_bcg_core(
    db: AsyncSession, user_id: str, datasource_id: str | None, cache: CacheService
) -> dict[str, Any]:
    """Dispatch to the demo or live matrix. ``None`` source → demo, demo-mode only."""
    if datasource_id is None:
        if not settings.DEMO_MODE:
            raise NexusBIException("Portfel matrisi üçün əvvəlcə mənbə seçin.")
        return await asyncio.to_thread(compute_bcg)  # sqlite seed off the event loop
    return await compute_bcg_for_source(db, user_id, datasource_id, cache)
