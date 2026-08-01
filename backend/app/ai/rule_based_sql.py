"""Deterministic NL->SQL fallback for the demo schema.

Used when the AI Text2SQL engine is unavailable (missing/invalid key, rate
limit, network error) so the demo experience keeps working offline. Mirrors the
``chart_selector._rule_based`` pattern: a heuristic that covers the common BI
questions over the demo tables (``sales`` / ``customers`` / ``products``).

The generated SQL is always a single SELECT and is re-validated by
``validate_select_only`` inside ``execute_demo_sql``.
"""
from __future__ import annotations

import re

from app.ai.types import Text2SQLResult

# ─── Keyword vocabulary (English + Azerbaijani) ───
_CUSTOMER_WORDS = ("customer", "müştəri", "musteri", "client")
_PRODUCT_WORDS = ("product", "məhsul", "mehsul", "stock", "anbar", "inventory")
# Sales metrics live only on the sales table — "products by revenue" is really a
# sales aggregation, so these win over the bare word "product".
_SALES_METRIC_WORDS = ("revenue", "gəlir", "gelir", "sales", "satış", "satis", "sold", "sale")
# Product-usage events (funnel stages) route to the events table.
_EVENT_WORDS = (
    "event", "hadisə", "hadise", "visit", "ziyarət", "ziyaret", "signup",
    "qeydiyyat", "trial", "sınaq", "sinaq", "funnel", "hunı", "huni",
)

_DIMENSIONS: list[tuple[tuple[str, ...], str, str]] = [
    # (keywords, column expression, output label)
    # English -y → -ies plurals are listed explicitly: "categories" does not
    # contain "category", so substring matching drops the dimension entirely and
    # the question falls through to an unrelated top-N. (-s plurals like
    # "regions"/"products" contain their singular and need no entry.)
    (("category", "categories", "kateqoriya"), "category", "category"),
    (("region", "bölgə", "bolge"), "region", "region"),
    (("country", "countries", "ölkə", "olke"), "country", "country"),
    (("month", "ay ", "aylıq", "ayliq"), "substr(sale_date, 1, 7)", "month"),
    (("date", "gün", "tarix"), "sale_date", "sale_date"),
    (("product", "məhsul", "mehsul"), "product_name", "product_name"),
    (("type", "növ", "nov", "mərhələ", "merhele", "step"), "event_type", "event_type"),
]

# Dimensions that form a time axis — a trend over these must read left→right in
# calendar order, so it is ORDER BY the dimension ASC, not ranked by its measure.
# (event_date is the events table's own daily axis, remapped in _pick_dimension.)
_TIME_LABELS = {"month", "sale_date", "event_date"}
# Row cap for a time series when the question named no number — roughly a year of
# daily points. See the call site for why a trend must not inherit the top-N 20.
_TREND_LIMIT = 400

_DESC_WORDS = ("top", "ən çox", "en cox", "highest", "most", "biggest", "ən böyük")
_ASC_WORDS = ("bottom", "ən az", "en az", "lowest", "least", "smallest", "ən kiçik")
_COUNT_WORDS = ("count", "say", "neçə", "nece", "number of", "how many")
# Words that merely CONTAIN a count keyword and would otherwise flip the measure
# to COUNT(*): "country" contains "count", "sayı" is a wanted Azerbaijani suffix
# form of "say" but "saytı" is not. Matching cannot be made word-exact instead —
# Azerbaijani is agglutinative, so "müştəri sayı" must still match "say".
# The demo schema has a `country` column, so this collision fires on every
# "<measure> by country" question and silently answers a different one.
_COUNT_FALSE_FRIENDS = ("country", "countries", "discount", "account")


def _pick_table(q: str) -> str:
    # Event vocabulary is the most specific — check before the generic tables.
    if any(w in q for w in _EVENT_WORDS):
        return "events"
    if any(w in q for w in _CUSTOMER_WORDS):
        return "customers"
    # A sales metric (revenue/satış) routes to sales even if "product" appears.
    if any(w in q for w in _SALES_METRIC_WORDS):
        return "sales"
    if any(w in q for w in _PRODUCT_WORDS):
        return "products"
    return "sales"


def _wants_count(q: str) -> bool:
    """True when the question asks for a row count rather than a measure."""
    for word in _COUNT_FALSE_FRIENDS:
        q = q.replace(word, " ")
    return any(w in q for w in _COUNT_WORDS)


def _pick_limit(q: str, default: int) -> int:
    m = re.search(r"\b(\d{1,3})\b", q)
    if m:
        return max(1, min(int(m.group(1)), 100))
    return default


def _direction(q: str) -> str:
    if any(w in q for w in _ASC_WORDS):
        return "ASC"
    return "DESC"


def _pick_dimension(q: str, table: str) -> tuple[str, str] | None:
    """Return (expression, label) for a GROUP BY dimension, or None."""
    for words, expr, label in _DIMENSIONS:
        if any(w in q for w in words):
            # The events table has its own date column; remap the time dims.
            if table == "events":
                if label == "month":
                    return "substr(event_date, 1, 7)", "month"
                if label == "sale_date":
                    return "event_date", "event_date"
                if expr == "event_type":
                    return expr, label
                continue
            if expr == "event_type":
                continue
            # product_name / sale_date / region only exist on the sales table.
            if expr in ("product_name", "substr(sale_date, 1, 7)", "sale_date", "region") and table != "sales":
                continue
            if expr == "country" and table != "customers":
                continue
            if expr == "category" and table == "customers":
                continue
            return expr, label
    return None


def _metric(table: str) -> tuple[str, str]:
    """Return (aggregate expression, label) for the table's headline metric."""
    if table == "sales":
        return "SUM(revenue)", "total_revenue"
    if table == "customers":
        return "SUM(total_spent)", "total_spent"
    if table == "events":
        return "COUNT(*)", "count"  # events carry no numeric measure
    return "SUM(stock_quantity)", "total_stock"


def generate_sql_fallback(nl_query: str) -> Text2SQLResult:
    """Best-effort deterministic SQL for the demo tables.

    Always returns a runnable SELECT. Falls back to a plain ``SELECT *`` preview
    when the question doesn't match a known aggregation pattern.
    """
    q = (nl_query or "").lower().strip()
    table = _pick_table(q)
    direction = _direction(q)

    # Pure count: "how many customers", "neçə məhsul".
    if _wants_count(q) and "by" not in q and "üzrə" not in q:
        dim = _pick_dimension(q, table)
        if dim is None:
            sql = f"SELECT COUNT(*) AS count FROM {table}"
            return _result(sql, "Sətir sayı (offline fallback).")

    # Aggregation by a dimension: "revenue by category", "kateqoriya üzrə satış".
    dim = _pick_dimension(q, table)
    if dim is not None:
        expr, label = dim
        if _wants_count(q):
            agg, agg_label = "COUNT(*)", "count"
        else:
            agg, agg_label = _metric(table)
        is_trend = label in _TIME_LABELS
        # A top-N list is meant to be cut at 20; a time series is not. Truncating
        # a trend keeps only its earliest points and silently reshapes the chart —
        # 48 days of events became the first 20. Monthly trends never exposed this
        # because 12 < 20. Bounded rather than unlimited, in the same spirit as
        # `demo_data._DEMO_MAX_ROWS`.
        limit = _pick_limit(q, _TREND_LIMIT if is_trend else 20)
        # Time trend → chronological; every other dimension → top-N by measure.
        order_by = f"ORDER BY {expr} ASC" if is_trend else f"ORDER BY {agg} {direction}"
        sql = (
            f"SELECT {expr} AS {label}, {agg} AS {agg_label} "
            f"FROM {table} GROUP BY {expr} "
            f"{order_by} LIMIT {limit}"
        )
        return _result(sql, f"{label} üzrə {agg_label} (offline fallback).")

    # Top-N entities: "top 5 products by revenue", "ən çox xərcləyən müştərilər".
    if any(w in q for w in _DESC_WORDS) or any(w in q for w in _ASC_WORDS):
        limit = _pick_limit(q, 10)
        if table == "customers":
            sql = (
                "SELECT name, total_spent FROM customers "
                f"ORDER BY total_spent {direction} LIMIT {limit}"
            )
        elif table == "products":
            sql = (
                "SELECT name, price, stock_quantity FROM products "
                f"ORDER BY price {direction} LIMIT {limit}"
            )
        else:
            sql = (
                "SELECT product_name, SUM(revenue) AS total_revenue FROM sales "
                f"GROUP BY product_name ORDER BY total_revenue {direction} LIMIT {limit}"
            )
        return _result(sql, "Sıralama (offline fallback).")

    # Headline total: "total revenue", "ümumi gəlir".
    if any(w in q for w in ("total", "ümumi", "umumi", "sum", "cəm", "cem")):
        agg, agg_label = _metric(table)
        sql = f"SELECT {agg} AS {agg_label} FROM {table}"
        return _result(sql, f"{agg_label} (offline fallback).")

    # Default: a bounded preview of the most relevant table.
    sql = f"SELECT * FROM {table} LIMIT 50"
    return _result(sql, "Nümunə sətirlər (offline fallback).")


def _result(sql: str, explanation: str) -> Text2SQLResult:
    return Text2SQLResult(
        sql=sql,
        explanation=explanation,
        confidence=0.3,
        warnings=["AI əlçatmaz olduğundan qayda-əsaslı SQL istifadə olundu."],
    )
