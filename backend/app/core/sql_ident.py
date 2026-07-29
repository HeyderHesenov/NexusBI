"""Dialect-aware identifier quoting for composed SQL.

Lives in `core` because five unrelated modules compose SQL — Explore, BA
evidence, BCG, profiling, AutoML and the offline data-prep fallback — and none of
them should have to import from another service to spell a table name.

Getting this wrong is silent rather than loud, which is why it has its own home:
MySQL's default `sql_mode` reads `"sales"` as the *string* 'sales', so
`SELECT * FROM "sales"` returns one row containing that word instead of raising.
Every downstream feature then reports confidently on nonsense.
"""
from __future__ import annotations


def quote_ident(ident: str, dialect: str) -> str:
    """Quote a schema identifier for ``dialect``.

    Input is always schema-sourced (an introspected table or column name), never
    free text — the doubling below is defence in depth, not a sanitiser.
    """
    if dialect == "mysql":
        return "`" + ident.replace("`", "``") + "`"
    return '"' + ident.replace('"', '""') + '"'
