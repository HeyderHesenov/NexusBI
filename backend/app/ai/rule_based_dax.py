"""Deterministic NL->DAX fallback for the Power BI sample model.

Used when the AI NL->DAX engine is unavailable (missing/invalid key, rate
limit). Mirrors rule_based_sql.py but emits the constrained DAX subset that
``powerbi.dax.dax_to_sql`` can execute, so the Power BI demo also works offline.
Reuses the keyword vocabulary from rule_based_sql to stay consistent.
"""
from __future__ import annotations

import re

from app.ai.rule_based_sql import (
    _ASC_WORDS,
    _COUNT_WORDS,
    _CUSTOMER_WORDS,
    _DESC_WORDS,
    _PRODUCT_WORDS,
    _SALES_METRIC_WORDS,
)
from app.ai.types import DAXResult

# sqlite table -> (DAX table name, headline measure column)
_DAX_TABLE = {"sales": "Sales", "customers": "Customers", "products": "Products"}
_DAX_METRIC = {"sales": "revenue", "customers": "total_spent", "products": "stock_quantity"}

# (keywords, column, valid sqlite tables)
_DIMENSIONS: list[tuple[tuple[str, ...], str, tuple[str, ...]]] = [
    (("category", "kateqoriya"), "category", ("sales", "products")),
    (("region", "bölgə", "bolge"), "region", ("sales",)),
    (("country", "ölkə", "olke"), "country", ("customers",)),
    (("product", "məhsul", "mehsul"), "product_name", ("sales",)),
]


def _pick_table(q: str) -> str:
    if any(w in q for w in _CUSTOMER_WORDS):
        return "customers"
    if any(w in q for w in _SALES_METRIC_WORDS):
        return "sales"
    if any(w in q for w in _PRODUCT_WORDS):
        return "products"
    return "sales"


def _pick_limit(q: str, default: int) -> int:
    m = re.search(r"\b(\d{1,3})\b", q)
    return max(1, min(int(m.group(1)), 100)) if m else default


def _pick_dimension(q: str, table: str) -> str | None:
    for words, col, tables in _DIMENSIONS:
        if any(w in q for w in words) and table in tables:
            return col
    return None


def generate_dax_fallback(nl_query: str) -> DAXResult:
    """Best-effort deterministic DAX over the sample model."""
    q = (nl_query or "").lower().strip()
    table = _pick_table(q)
    dax_table = _DAX_TABLE[table]
    metric = _DAX_METRIC[table]
    direction = "ASC" if any(w in q for w in _ASC_WORDS) else "DESC"
    is_count = any(w in q for w in _COUNT_WORDS)

    dim = _pick_dimension(q, table)
    if dim is not None:
        if is_count:
            alias, agg = "Count", f"COUNTROWS('{dax_table}')"
        else:
            alias, agg = "Total", f"SUM('{dax_table}'[{metric}])"
        summarize = f"SUMMARIZECOLUMNS('{dax_table}'[{dim}], \"{alias}\", {agg})"
        limit = _pick_limit(q, 20)
        dax = f"EVALUATE TOPN({limit}, {summarize}, [{alias}], {direction})"
        return _result(dax, f"{dim} üzrə {alias} (offline DAX fallback).")

    if any(w in q for w in _DESC_WORDS) or any(w in q for w in _ASC_WORDS):
        # Top-N entities by the headline measure.
        group = "name" if table != "sales" else "product_name"
        summarize = (
            f"SUMMARIZECOLUMNS('{dax_table}'[{group}], \"Total\", "
            f"SUM('{dax_table}'[{metric}]))"
        )
        limit = _pick_limit(q, 10)
        dax = f"EVALUATE TOPN({limit}, {summarize}, [Total], {direction})"
        return _result(dax, "Sıralama (offline DAX fallback).")

    if any(w in q for w in ("total", "ümumi", "umumi", "sum", "cəm", "cem")):
        dax = f"EVALUATE SUMMARIZECOLUMNS(\"Total\", SUM('{dax_table}'[{metric}]))"
        return _result(dax, "Ümumi cəm (offline DAX fallback).")

    dax = f"EVALUATE '{dax_table}'"
    return _result(dax, "Nümunə sətirlər (offline DAX fallback).")


def _result(dax: str, explanation: str) -> DAXResult:
    return DAXResult(
        dax=dax,
        explanation=explanation,
        confidence=0.3,
        warnings=["AI əlçatmaz olduğundan qayda-əsaslı DAX istifadə olundu."],
    )
