"""Inject a dashboard's global filter into each widget's stored SQL.

A dashboard-level filter (a date range + dimension slicers) must apply to EVERY
widget, but each widget runs its own AI-generated SELECT against its own source.
Rather than re-generate SQL, we rewrite the stored SELECT with sqlglot — AND-ing
``table.column`` predicates into the WHERE of every SELECT scope that reads a
table owning the filter column, so the filter runs BEFORE aggregation (a filter
pushed post-aggregation would leave SUM/GROUP BY totals unfiltered).

Unlike RLS (``rls_sql.constrain_sql``) this is fail-OPEN: a global filter is a
convenience, not a security boundary. If a widget's query doesn't reference the
filter column, or the SQL can't be parsed, that widget is simply left unfiltered
— never an error. Filter VALUES flow through ``exp.Literal`` so they are escaped;
a filter COLUMN is only ever emitted after it is confirmed to exist in the
schema, never string-concatenated.
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Any

import sqlglot
from sqlglot import exp

# Map our DBType.value → sqlglot dialect name (sqlite is the default for uploads).
_DIALECTS = {"postgresql": "postgres", "mysql": "mysql", "sqlite": "sqlite"}


def _columns_by_table(schema: dict[str, Any]) -> dict[str, dict[str, str]]:
    """schema dict ({table: [{name,type}|str]}) → {table: {lower_name: actual_name}}.

    Lower-cased keys make column matching case-insensitive (SQL identifiers fold
    case unless quoted); the value keeps the schema's real casing so the emitted
    predicate references the column exactly as it exists on the source."""
    out: dict[str, dict[str, str]] = {}
    for table, cols in schema.items():
        names: dict[str, str] = {}
        for c in cols or []:
            actual = str(c["name"]) if isinstance(c, dict) else str(c)
            names[actual.lower()] = actual
        out[table] = names
    return out


def _dimension_predicate(ref: str, column: str, values: list[str]) -> exp.Expression:
    """Build ``CAST(ref.column AS TEXT) IN ('v1', 'v2')`` (escaped literals)."""
    col = exp.cast(exp.column(column, table=ref), "text")
    return exp.In(this=col, expressions=[exp.Literal.string(v) for v in values])


def _next_day(iso: str) -> str | None:
    """'2024-01-31' → '2024-02-01'; None if not a plain ISO date."""
    try:
        return (date.fromisoformat(iso) + timedelta(days=1)).isoformat()
    except ValueError:
        return None


def _date_predicates(ref: str, column: str, start: str | None, end: str | None) -> list[exp.Expression]:
    """Build a half-open range ``col >= start AND col < end+1day``.

    The end bound is made exclusive on the *next* day so a DATETIME/TIMESTAMP row
    with a non-midnight time on the last day is still included (``col <= 'end'``
    would wrongly drop ``2024-01-31 14:30`` for end ``2024-01-31``). Falls back to
    ``<= end`` if the end value isn't a plain ISO date."""
    preds: list[exp.Expression] = []
    col = exp.column(column, table=ref)
    if start:
        preds.append(exp.GTE(this=col, expression=exp.Literal.string(start)))
    if end:
        nxt = _next_day(end)
        if nxt:
            preds.append(exp.LT(this=col, expression=exp.Literal.string(nxt)))
        else:
            preds.append(exp.LTE(this=col, expression=exp.Literal.string(end)))
    return preds


def _normalize(spec: dict[str, Any] | None) -> tuple[dict[str, list[str]], str | None, str | None, str | None]:
    """Return (dimensions{col:[values]}, date_column, date_start, date_end) — only
    the parts that carry an actual constraint. Empty → nothing to inject."""
    if not spec:
        return {}, None, None, None
    dims: dict[str, list[str]] = {}
    for d in spec.get("dimensions") or []:
        col = d.get("column")
        values = [str(v) for v in (d.get("values") or []) if v is not None and str(v) != ""]
        if col and values:
            dims.setdefault(str(col), []).extend(values)
    date_col = spec.get("date_column") or None
    start = spec.get("date_start") or None
    end = spec.get("date_end") or None
    if not date_col or (not start and not end):
        date_col = start = end = None
    return dims, date_col, start, end


def filter_active(spec: dict[str, Any] | None) -> bool:
    """True when ``spec`` actually constrains something (a dated range or a
    dimension with values) — an all-empty spec is treated as no filter."""
    dims, date_col, _, _ = _normalize(spec)
    return bool(dims) or bool(date_col)


def apply_filter(
    sql: str,
    spec: dict[str, Any] | None,
    schema: dict[str, Any],
    dialect: str = "sqlite",
) -> str:
    """Return ``sql`` with the dashboard's global filter AND-ed in where it applies.

    Fail-OPEN: returns ``sql`` unchanged when the spec is empty, the SQL can't be
    parsed, or none of the referenced tables own a filter column.
    """
    dims, date_col, date_start, date_end = _normalize(spec)
    if not dims and not date_col:
        return sql

    glot_dialect = _DIALECTS.get(dialect, "sqlite")
    try:
        tree = sqlglot.parse_one(sql, dialect=glot_dialect)
    except Exception:
        return sql  # unparseable → leave the widget unfiltered (fail-open)
    if tree is None:
        return sql

    # {table_lower: {col_lower: actual_name}} — table names fold case too.
    cols_by_table = {t.lower(): cols for t, cols in _columns_by_table(schema).items()}

    def actual_name(tname: str, col: str) -> str | None:
        """The column's real casing on ``tname`` if it owns ``col`` (else None)."""
        return cols_by_table.get(tname, {}).get(col.lower())

    # CTE / derived-relation names shadow physical tables — a reference to a WITH
    # name is not the base table, so skip it (the real read inside the CTE body is
    # a separate exp.Table handled in its own scope).
    cte_names = {c.alias.lower() for c in tree.find_all(exp.CTE) if c.alias}

    # Apply each filter column to at most ONE table (the first in query order that
    # owns it). Unlike RLS — which must fan out to every owner to stay fail-closed
    # — a convenience filter AND-ed into every table sharing a common column name
    # (id, name, category…) across a join would over-restrict and drop correct
    # rows. Binding once to the first owner matches the dimension the user sees.
    done_dims: set[str] = set()
    date_done = False
    applied = False
    for table in list(tree.find_all(exp.Table)):
        tname = (table.name or "").lower()
        if not tname or tname in cte_names:
            continue
        scope = table.find_ancestor(exp.Select)
        if scope is None:
            continue
        ref = table.alias_or_name
        for col, values in dims.items():
            if col in done_dims:
                continue
            real = actual_name(tname, col)
            if real is not None:
                scope.where(_dimension_predicate(ref, real, values), copy=False)
                done_dims.add(col)
                applied = True
        if date_col and not date_done:
            real = actual_name(tname, date_col)
            if real is not None:
                for pred in _date_predicates(ref, real, date_start, date_end):
                    scope.where(pred, copy=False)
                date_done = True
                applied = True

    if not applied:
        return sql  # no referenced table owns a filter column → unchanged
    return tree.sql(dialect=glot_dialect)
