"""Push row-level security into the SQL itself (predicate injection).

Post-fetch row filtering (``rls_service.apply``) cannot constrain server-side
aggregates — ``SELECT SUM(revenue) FROM sales`` returns the full-tenant total
because the restricted column never reaches the output rows. Instead we rewrite
the AI-generated SELECT with sqlglot, AND-ing ``table.column IN (allowed…)`` into
the WHERE of every SELECT scope that reads a protected table, so the filter runs
BEFORE aggregation.

Fail-CLOSED: any SQL we cannot parse, or any protected column we cannot locate
in the schema or cannot prove we applied, raises ``InvalidSQLError`` rather than
returning under-constrained rows.
"""
from __future__ import annotations

from typing import Any

import sqlglot
from sqlglot import exp

from app.core.exceptions import InvalidSQLError
from app.models.workspace import RLSRule

# Map our DBType.value → sqlglot dialect name (sqlite is the default for uploads).
_DIALECTS = {"postgresql": "postgres", "mysql": "mysql", "sqlite": "sqlite"}


def _columns_by_table(schema: dict[str, Any]) -> dict[str, set[str]]:
    """schema dict ({table: [{name,type}|str]}) → {table: {column names}}."""
    out: dict[str, set[str]] = {}
    for table, cols in schema.items():
        names: set[str] = set()
        for c in cols or []:
            names.add(str(c["name"]) if isinstance(c, dict) else str(c))
        out[table] = names
    return out


def _in_predicate(ref: str, column: str, values: list[str]) -> exp.Expression:
    """Build ``CAST(ref.column AS TEXT) IN ('v1', 'v2')``.

    Casting to text mirrors the string comparison the post-fetch filter used and
    avoids int/text mismatch errors on strict dialects (Postgres). Values flow
    through ``exp.Literal.string`` so quotes are escaped — no SQL injection from
    a crafted ``allowed_value``.
    """
    col = exp.cast(exp.column(column, table=ref), "text")
    return exp.In(this=col, expressions=[exp.Literal.string(v) for v in values])


def constrain_sql(
    sql: str,
    rules: list[RLSRule],
    schema: dict[str, Any],
    dialect: str = "sqlite",
) -> str:
    """Return ``sql`` rewritten so every protected table is row-filtered.

    No-op (returns the original) when ``rules`` is empty. Raises
    ``InvalidSQLError`` (fail-closed) when the SQL can't be parsed, a protected
    column isn't in the schema, or a protected table is referenced but we failed
    to attach its predicate.
    """
    if not rules:
        return sql

    allowed: dict[str, list[str]] = {}
    for r in rules:
        allowed.setdefault(r.column, []).append(r.allowed_value)

    glot_dialect = _DIALECTS.get(dialect, "sqlite")
    try:
        tree = sqlglot.parse_one(sql, dialect=glot_dialect)
    except Exception as exc:  # sqlglot.errors.ParseError and friends
        raise InvalidSQLError("RLS tətbiqi üçün SQL təhlil olunmadı.") from exc
    if tree is None:
        raise InvalidSQLError("RLS: boş SQL.")

    cols_by_table = _columns_by_table(schema)
    # Every protected column must exist somewhere in the schema, else we can't
    # enforce it → block. Owners are compared case-INSENSITIVELY: unquoted SQL
    # identifiers fold case, so `FROM SALES` reads the same table as `sales` and
    # must still be constrained (a case mismatch must never bypass RLS).
    owners_of: dict[str, set[str]] = {}
    for col in allowed:
        owners = {t.lower() for t, cs in cols_by_table.items() if col in cs}
        if not owners:
            raise InvalidSQLError(f"RLS: '{col}' sütunu data mənbəyinin sxemasında yoxdur.")
        owners_of[col] = owners

    # CTE / derived-relation names shadow physical tables: a reference to a name
    # defined by WITH binds to that CTE, not the protected base table (which is
    # then unreachable by that name). Skip such references — the real read inside
    # the CTE body is a separate exp.Table that gets constrained in its own scope.
    cte_names = {c.alias.lower() for c in tree.find_all(exp.CTE) if c.alias}

    # Track touched vs constrained (by (table, column)) so we fail-CLOSED if a
    # protected table is read but we couldn't attach its predicate.
    touched: set[tuple[str, str]] = set()
    constrained: set[tuple[str, str]] = set()

    # Materialize first — we mutate WHERE clauses while iterating.
    for table in list(tree.find_all(exp.Table)):
        tname = (table.name or "").lower()
        if not tname or tname in cte_names:
            continue
        protected_cols = [col for col, owners in owners_of.items() if tname in owners]
        if not protected_cols:
            continue
        # Record touched BEFORE deciding we can constrain — the fail-closed
        # invariant must catch "read but unconstrained", never silently skip.
        for col in protected_cols:
            touched.add((tname, col))
        scope = table.find_ancestor(exp.Select)
        if scope is None:
            raise InvalidSQLError("RLS: qorunan cədvəl SELECT konteksti xaricində istinad olunub.")
        ref = table.alias_or_name
        for col in protected_cols:
            scope.where(_in_predicate(ref, col, allowed[col]), copy=False)
            constrained.add((tname, col))

    if touched - constrained:
        raise InvalidSQLError("RLS predikatı bəzi cədvəllərə tətbiq olunmadı.")

    return tree.sql(dialect=glot_dialect)
