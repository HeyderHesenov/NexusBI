"""Translate a supported subset of DAX into SQLite SQL for the mock provider.

This is NOT a full DAX engine. It covers the canonical query shapes the NL->DAX
prompt is constrained to emit, which is enough for the demo:

    EVALUATE 'Sales'
    EVALUATE SUMMARIZECOLUMNS('Sales'[category], "Total Revenue", SUM('Sales'[revenue]))
    EVALUATE TOPN(5,
        SUMMARIZECOLUMNS('Sales'[product_name], "Total Revenue", SUM('Sales'[revenue])),
        [Total Revenue], DESC)
    EVALUATE <expr> ORDER BY [Total Revenue] DESC

Anything outside this subset raises InvalidSQLError so the caller can fall back
to a deterministic rule-based DAX path.
"""
from __future__ import annotations

import re

from app.core.exceptions import InvalidSQLError
from app.services.powerbi import sample_model

_AGG_FUNCS = {
    "SUM": "SUM",
    "AVERAGE": "AVG",
    "MIN": "MIN",
    "MAX": "MAX",
    "COUNT": "COUNT",
    "DISTINCTCOUNT": "COUNT(DISTINCT {})",
    "COUNTROWS": "COUNT(*)",
}

_MAX_ROWS = 10000


def dax_to_sql(dax: str) -> str:
    """Convert a supported DAX EVALUATE query into SQLite SQL. Raise on unsupported."""
    text = _normalize(dax)
    if not text.upper().startswith("EVALUATE"):
        raise InvalidSQLError("Yalnız EVALUATE ilə başlayan DAX dəstəklənir.", detail=dax[:200])
    body = text[len("EVALUATE"):].strip()

    body, order_by = _split_trailing_order_by(body)
    limit: int | None = None
    direction = "DESC"

    if body.upper().startswith("TOPN"):
        inner, n, topn_order, topn_dir = _parse_topn(body)
        limit = n
        body = inner
        if topn_order and not order_by:
            order_by, direction = topn_order, topn_dir

    table, group_cols, measures = _parse_expr(body)

    select_parts: list[str] = []
    for col in group_cols:
        select_parts.append(f"{col} AS {col}")
    for alias, agg_sql in measures:
        select_parts.append(f'{agg_sql} AS "{alias}"')
    if not select_parts:
        select_parts = ["*"]

    sql = f"SELECT {', '.join(select_parts)} FROM {table}"
    if group_cols and measures:
        sql += f" GROUP BY {', '.join(group_cols)}"

    order_sql = _resolve_order_by(order_by, direction)
    if order_sql:
        sql += f" ORDER BY {order_sql}"
    sql += f" LIMIT {limit if limit is not None else _MAX_ROWS}"
    return sql


# ─── parsing helpers ───

def _normalize(dax: str) -> str:
    return re.sub(r"\s+", " ", (dax or "").strip())


def _split_top_level(s: str, sep: str = ",") -> list[str]:
    """Split on `sep` at paren/bracket depth 0, respecting quotes."""
    parts: list[str] = []
    depth = 0
    quote: str | None = None
    cur: list[str] = []
    for ch in s:
        if quote:
            cur.append(ch)
            if ch == quote:
                quote = None
            continue
        if ch in "'\"":
            quote = ch
            cur.append(ch)
        elif ch in "([":
            depth += 1
            cur.append(ch)
        elif ch in ")]":
            depth -= 1
            cur.append(ch)
        elif ch == sep and depth == 0:
            parts.append("".join(cur).strip())
            cur = []
        else:
            cur.append(ch)
    if cur:
        parts.append("".join(cur).strip())
    return [p for p in parts if p]


def _inner(call: str, func: str) -> str:
    """Return the argument string inside FUNC( ... )."""
    m = re.match(rf"^{func}\s*\((.*)\)$", call, re.IGNORECASE | re.DOTALL)
    if not m:
        raise InvalidSQLError(f"{func} sintaksisi tanınmadı.", detail=call[:200])
    return m.group(1).strip()


def _parse_topn(body: str) -> tuple[str, int, str | None, str]:
    args = _split_top_level(_inner(body, "TOPN"))
    if len(args) < 2:
        raise InvalidSQLError("TOPN ən azı 2 arqument tələb edir.", detail=body[:200])
    try:
        n = int(args[0])
    except ValueError as exc:
        raise InvalidSQLError("TOPN ilk arqumenti ədəd olmalıdır.", detail=args[0]) from exc
    inner = args[1]
    order_expr = args[2] if len(args) >= 3 else None
    direction = "DESC"
    if len(args) >= 4 and args[3].strip().upper() in ("ASC", "DESC"):
        direction = args[3].strip().upper()
    return inner, n, order_expr, direction


def _parse_expr(expr: str) -> tuple[str, list[str], list[tuple[str, str]]]:
    """Return (sqlite_table, group_columns, [(measure_alias, agg_sql)])."""
    expr = expr.strip()
    if expr.upper().startswith("SUMMARIZECOLUMNS"):
        return _parse_summarizecolumns(expr)
    # Bare table reference: EVALUATE 'Sales'
    table = sample_model.sqlite_table(expr)
    if table is None:
        raise InvalidSQLError("Dəstəklənməyən DAX ifadəsi.", detail=expr[:200])
    return table, [], []


def _parse_summarizecolumns(expr: str) -> tuple[str, list[str], list[tuple[str, str]]]:
    args = _split_top_level(_inner(expr, "SUMMARIZECOLUMNS"))
    group_cols: list[str] = []
    measures: list[tuple[str, str]] = []
    table: str | None = None
    i = 0
    while i < len(args):
        arg = args[i]
        if arg.startswith('"'):
            # Measure pair: "Alias", <aggregate(...)>
            alias = arg.strip('"')
            if i + 1 >= len(args):
                raise InvalidSQLError("Ölçü ifadəsi əskikdir.", detail=expr[:200])
            agg_sql, agg_table = _parse_aggregate(args[i + 1])
            table = table or agg_table
            measures.append((alias, agg_sql))
            i += 2
        else:
            # Group-by column reference.
            tbl, col = _parse_colref(arg)
            table = table or tbl
            group_cols.append(col)
            i += 1
    if table is None:
        raise InvalidSQLError("DAX cədvəli müəyyən edilmədi.", detail=expr[:200])
    return table, group_cols, measures


def _parse_colref(token: str) -> tuple[str | None, str]:
    """Parse 'Table'[col] or [col] -> (sqlite_table_or_None, column)."""
    m = re.match(r"^\s*(?:'?([\w ]+)'?\s*)?\[([\w ]+)\]\s*$", token)
    if not m:
        raise InvalidSQLError("Sütun istinadı tanınmadı.", detail=token[:120])
    dax_table, col = m.group(1), m.group(2).strip()
    table = sample_model.sqlite_table(dax_table) if dax_table else None
    return table, col


def _parse_aggregate(token: str) -> tuple[str, str | None]:
    """Parse SUM('T'[c]) / COUNTROWS('T') -> (sql_agg, sqlite_table_or_None)."""
    token = token.strip()
    m = re.match(r"^(\w+)\s*\((.*)\)$", token, re.DOTALL)
    if not m:
        raise InvalidSQLError("Aqreqat funksiya tanınmadı.", detail=token[:120])
    func, inner = m.group(1).upper(), m.group(2).strip()
    if func not in _AGG_FUNCS:
        raise InvalidSQLError(f"Dəstəklənməyən aqreqat: {func}.", detail=token[:120])

    if func == "COUNTROWS":
        table = sample_model.sqlite_table(inner)
        return "COUNT(*)", table
    tbl, col = _parse_colref(inner)
    if func == "DISTINCTCOUNT":
        return f"COUNT(DISTINCT {col})", tbl
    return f"{_AGG_FUNCS[func]}({col})", tbl


def _split_trailing_order_by(body: str) -> tuple[str, str | None]:
    """Pull a top-level trailing `ORDER BY ...` off the expression."""
    depth = 0
    quote: str | None = None
    upper = body.upper()
    for idx in range(len(body)):
        ch = body[idx]
        if quote:
            if ch == quote:
                quote = None
            continue
        if ch in "'\"":
            quote = ch
        elif ch in "([":
            depth += 1
        elif ch in ")]":
            depth -= 1
        elif depth == 0 and upper[idx:idx + 9] == "ORDER BY ":
            return body[:idx].strip(), body[idx + 9:].strip()
    return body.strip(), None


def _resolve_order_by(order_by: str | None, direction: str) -> str | None:
    if not order_by:
        return None
    expr = order_by.strip()
    # Pull an optional trailing ASC/DESC (the column name itself may contain
    # spaces, e.g. [Total Revenue], so a plain split() won't do).
    dm = re.search(r"\s+(ASC|DESC)\s*$", expr, re.IGNORECASE)
    if dm:
        direction = dm.group(1).upper()
        expr = expr[: dm.start()].strip()
    # Measure reference [Alias].
    m = re.match(r"^\[([\w ]+)\]$", expr)
    if m:
        return f'"{m.group(1).strip()}" {direction}'
    # Column reference 'Table'[col].
    _, col = _parse_colref(expr)
    return f"{col} {direction}"
