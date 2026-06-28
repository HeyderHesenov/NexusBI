"""Deterministic query lineage: source tables/columns + metrics behind a result.

Parses the stored SQL with regex (no AI) so it's fast and reproducible. DAX/other
languages simply yield no tables — callers treat lineage as best-effort.
"""
from __future__ import annotations

import re
from typing import Any

from app.models.metric import Metric
from app.models.query_log import QueryLog

_TABLE_RE = re.compile(r'(?:from|join)\s+["`\[]?([a-zA-Z_]\w*)', re.IGNORECASE)
_QUALIFIED_COL_RE = re.compile(r"\b\w+\.([a-zA-Z_]\w*)")
_CTE_RE = re.compile(r'(?:with|,)\s+["`\[]?([a-zA-Z_]\w*)["`\]]?\s+as\s*\(', re.IGNORECASE)
_MIN_METRIC_TOKEN = 3  # avoid 1-2 char synonyms matching unrelated substrings


def _unique(items: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for it in items:
        if it and it.lower() not in seen:
            seen.add(it.lower())
            out.append(it)
    return out


def lineage_for_query(log: QueryLog, metrics: list[Metric]) -> dict[str, Any]:
    """Return {tables, columns, metrics} for a query log."""
    sql = log.generated_sql or ""
    # Exclude CTE names (WITH x AS (...)) — they're query-local, not source tables.
    ctes = {c.lower() for c in _CTE_RE.findall(sql)}
    tables = [t for t in _unique(_TABLE_RE.findall(sql)) if t.lower() not in ctes]

    result = log.result_data or {}
    output_cols = [str(c) for c in result.get("columns", []) if c]
    columns = output_cols or _unique(_QUALIFIED_COL_RE.findall(sql))

    hay = f"{sql} {log.natural_language or ''}".lower()

    def _mentions(token: str) -> bool:
        token = token.strip().lower()
        if len(token) < _MIN_METRIC_TOKEN:
            return False
        # Word-boundary match so short synonyms don't hit unrelated substrings.
        return re.search(rf"\b{re.escape(token)}\b", hay) is not None

    matched: list[str] = []
    for m in metrics:
        names = [m.name] + [s for s in (m.synonyms or "").split(",")]
        if any(_mentions(n) for n in names):
            matched.append(m.name)
    return {"tables": tables, "columns": columns, "metrics": _unique(matched)}
