"""Demo mode: in-memory SQLite seeded with synthetic BI data.

When DEMO_MODE is on and no datasource is selected, the AI-generated SQL runs
against this throwaway database so the full pipeline works without a real DB.
"""
from __future__ import annotations

import sqlite3
import time
from typing import Any

from app.ai.schema_introspector import format_schema_for_prompt
from app.ai.sql_guard import validate_select_only
from app.core.exceptions import InvalidSQLError

DEMO_SCHEMA: dict[str, list[str]] = {
    "sales": [
        "id", "product_name", "category", "revenue",
        "quantity", "sale_date", "region", "customer_id",
    ],
    "customers": ["id", "name", "email", "country", "signup_date", "total_spent"],
    "products": ["id", "name", "category", "price", "stock_quantity"],
    "events": ["id", "customer_id", "event_type", "event_date"],
}

_CATEGORIES = ["Electronics", "Clothing", "Home", "Sports", "Books"]
_REGIONS = ["North", "South", "East", "West", "Central"]
_COUNTRIES = ["Azerbaijan", "Turkey", "Georgia", "Germany", "USA"]
_MONTHS = [f"2024-{m:02d}" for m in range(1, 13)]

# Single source of truth for the funnel stage vocabulary — the events seed below
# keys off these names.
FUNNEL_EVENT_STEPS = ["visit", "signup", "trial", "purchase"]

# Live-feed multipliers per category (1.0 = baseline). The "live dashboard"
# simulator (services.demo_feed) random-walks these so that re-running the same
# query returns visibly different revenue each tick — making live mode tangible
# on the otherwise-static demo dataset. No effect until something nudges them.
_LIVE_FACTORS: dict[str, float] = {cat: 1.0 for cat in _CATEGORIES}


def current_live_factors() -> dict[str, float]:
    """A copy of the current per-category live multipliers."""
    return dict(_LIVE_FACTORS)


def set_live_factors(factors: dict[str, float]) -> None:
    """Replace the live multipliers used by the next demo query (in place)."""
    _LIVE_FACTORS.update(factors)


def _live_factor(category: str) -> float:
    return _LIVE_FACTORS.get(category, 1.0)


def _product_name(i: int) -> str:
    return f"Product {chr(65 + (i % 26))}{i}"


def _seed(conn: sqlite3.Connection) -> None:
    cur = conn.cursor()
    cur.execute(
        "CREATE TABLE products (id INTEGER, name TEXT, category TEXT,"
        " price REAL, stock_quantity INTEGER)"
    )
    cur.execute(
        "CREATE TABLE sales (id INTEGER, product_name TEXT, category TEXT,"
        " revenue REAL, quantity INTEGER, sale_date TEXT, region TEXT, customer_id INTEGER)"
    )
    cur.execute(
        "CREATE TABLE customers (id INTEGER, name TEXT, email TEXT,"
        " country TEXT, signup_date TEXT, total_spent REAL)"
    )

    products = []
    for i in range(20):
        cat = _CATEGORIES[i % len(_CATEGORIES)]
        products.append(
            (i + 1, _product_name(i), cat, 10.0 + (i % 10) * 5, 50 + (i * 7) % 200)
        )
    cur.executemany("INSERT INTO products VALUES (?,?,?,?,?)", products)

    sales = []
    sid = 1
    for i in range(300):
        p = products[i % len(products)]
        qty = 1 + (i % 9)
        revenue = round(p[3] * qty * (1 + (i % 5) * 0.1) * _live_factor(p[2]), 2)
        sales.append(
            (
                sid,
                p[1],  # product_name
                p[2],  # category
                revenue,
                qty,
                _MONTHS[i % 12] + "-15",
                _REGIONS[i % len(_REGIONS)],
                (i % 60) + 1,  # customer_id → customers.id (60 customers, ~5 sales each)
            )
        )
        sid += 1
    cur.executemany("INSERT INTO sales VALUES (?,?,?,?,?,?,?,?)", sales)

    customers = []
    for i in range(60):
        customers.append(
            (
                i + 1,
                f"Customer {i + 1}",
                f"customer{i + 1}@example.com",
                _COUNTRIES[i % len(_COUNTRIES)],
                _MONTHS[i % 12] + "-01",
                round(100 + (i * 37) % 5000, 2),
            )
        )
    cur.executemany("INSERT INTO customers VALUES (?,?,?,?,?,?)", customers)

    cur.execute(
        "CREATE TABLE events (id INTEGER, customer_id INTEGER,"
        " event_type TEXT, event_date TEXT)"
    )
    # Deterministic product-usage events backing the demo NL "funnel"-style queries.
    # Funnel (distinct customers per step): 60 visit → 45 signup → 30 trial →
    # 20 purchase (nested prefixes of customer id). Each customer i also emits visit
    # rows across (i % 5)+1 consecutive months from its first-activity month
    # (capped at 2024-12), giving a deterministic multi-month event spread.
    visit, signup, trial, purchase = FUNNEL_EVENT_STEPS
    events = []
    eid = 1
    for i in range(1, 61):
        m0 = (i - 1) % 12  # first-activity month index, matches signup_date
        for k in range(0, (i % 5) + 1):
            if m0 + k > 11:
                break
            events.append((eid, i, visit, _MONTHS[m0 + k] + "-02"))
            eid += 1
        for step, cutoff, day in ((signup, 45, "-05"), (trial, 30, "-08"), (purchase, 20, "-12")):
            if i <= cutoff:
                events.append((eid, i, step, _MONTHS[m0] + day))
                eid += 1
    cur.executemany("INSERT INTO events VALUES (?,?,?,?)", events)
    conn.commit()


# Real column types + representative sample values for the Text2SQL prompt. Giving
# the model the actual type (so it knows which columns are numeric/aggregatable) and
# concrete sample values (so it filters with the right literals, e.g. region='North')
# materially improves generation quality over a bare "TEXT/NUMERIC" hint.
_DEMO_COLUMN_META: dict[str, list[tuple[str, str, list[str]]]] = {
    "sales": [
        ("id", "INTEGER", []),
        ("product_name", "TEXT", ["Product A0", "Product B1"]),
        ("category", "TEXT", _CATEGORIES[:3]),
        ("revenue", "NUMERIC", ["1234.5", "87.0"]),
        ("quantity", "INTEGER", ["3", "12"]),
        ("sale_date", "DATE", ["2024-03-15", "2024-11-15"]),  # always day 15
        ("region", "TEXT", _REGIONS[:3]),
        ("customer_id", "INTEGER", ["1", "2"]),  # → customers.id
    ],
    "customers": [
        ("id", "INTEGER", []),
        ("name", "TEXT", ["Customer 7", "Customer 42"]),
        ("email", "TEXT", ["customer7@example.com"]),
        ("country", "TEXT", _COUNTRIES[:3]),
        ("signup_date", "DATE", ["2024-01-01"]),  # always day 01
        ("total_spent", "NUMERIC", ["4210.0", "880.25"]),
    ],
    "products": [
        ("id", "INTEGER", []),
        ("name", "TEXT", ["Product A0", "Product B1"]),
        ("category", "TEXT", _CATEGORIES[:3]),
        ("price", "NUMERIC", ["15.0", "55.0"]),
        ("stock_quantity", "INTEGER", ["50", "150"]),
    ],
    "events": [
        ("id", "INTEGER", []),
        ("customer_id", "INTEGER", ["1", "2"]),  # → customers.id
        ("event_type", "TEXT", ["visit", "signup", "trial", "purchase"]),
        ("event_date", "DATE", ["2024-03-02", "2024-07-05"]),
    ],
}


def demo_table_names() -> list[str]:
    """Table names in the demo model — the SELECT allowlist for demo-mode SQL."""
    return list(_DEMO_COLUMN_META.keys())


def demo_column_meta() -> dict[str, list[tuple[str, str, list[str]]]]:
    """Per-table (column, type, samples). Treat as read-only — module-level state."""
    return _DEMO_COLUMN_META


def format_demo_schema() -> str:
    """Schema text for the Text2SQL prompt — real types + sample values."""
    schema = {
        table: [
            {"name": col, "type": typ, "samples": samples}
            for col, typ, samples in cols
        ]
        for table, cols in _DEMO_COLUMN_META.items()
    }
    return format_schema_for_prompt(schema)


# Upper bound on rows returned from a single demo query — matches the live
# path's MAX_RESULT_ROWS so a crafted CROSS JOIN can't exhaust worker memory.
_DEMO_MAX_ROWS = 10000
# Wall-clock budget for a single demo query. The in-memory engine has no
# statement_timeout (unlike the live Postgres/MySQL path), so a crafted heavy
# CROSS JOIN / aggregate could otherwise pin a worker indefinitely. The progress
# handler aborts execution past this deadline.
_DEMO_MAX_SECONDS = 5.0
_DEMO_PROGRESS_OPS = 100_000  # handler fires roughly every N VM instructions


def execute_demo_sql(sql: str) -> tuple[list[str], list[dict[str, Any]]]:
    """Run the SELECT against a freshly seeded in-memory database."""
    sql = validate_select_only(sql)  # defense in depth
    conn = sqlite3.connect(":memory:")
    try:
        # Never allow extension loading even on a throwaway connection.
        try:
            conn.enable_load_extension(False)
        except AttributeError:
            pass
        _seed(conn)
        conn.row_factory = sqlite3.Row
        # Abort (non-zero return) once the wall-clock budget is exceeded so no
        # single query can hang the worker thread.
        deadline = time.monotonic() + _DEMO_MAX_SECONDS
        conn.set_progress_handler(
            lambda: 1 if time.monotonic() > deadline else 0, _DEMO_PROGRESS_OPS
        )
        cur = conn.execute(sql)
        # Bound the fetch: a power-user CROSS JOIN over the demo tables could
        # otherwise materialize unbounded rows (the live path caps at MAX_RESULT_ROWS).
        rows = cur.fetchmany(_DEMO_MAX_ROWS)
        columns = [d[0] for d in cur.description] if cur.description else []
        return columns, [dict(r) for r in rows]
    except sqlite3.Error as exc:
        raise InvalidSQLError("Demo SQL icra olunmadı.", detail=str(exc)) from exc
    finally:
        conn.close()


def execute_demo_snapshot(sqls: list[str]) -> list[list[dict[str, Any]] | None]:
    """Run several SELECTs against ONE freshly-seeded snapshot.

    All queries see identical data — essential for drift comparison: the live-demo
    feed mutates revenue between separate ``execute_demo_sql`` calls, which would
    make two runs of the SAME query disagree. A query that errors yields ``None``
    (so callers can tell a baseline failure apart from a real result).
    """
    conn = sqlite3.connect(":memory:")
    try:
        try:
            conn.enable_load_extension(False)
        except AttributeError:
            pass
        _seed(conn)
        conn.row_factory = sqlite3.Row
        out: list[list[dict[str, Any]] | None] = []
        for sql in sqls:
            try:
                cur = conn.execute(validate_select_only(sql))
                out.append([dict(r) for r in cur.fetchall()])
            except sqlite3.Error:
                out.append(None)
        return out
    finally:
        conn.close()
