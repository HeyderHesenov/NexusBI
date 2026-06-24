"""Demo mode: in-memory SQLite seeded with synthetic BI data.

When DEMO_MODE is on and no datasource is selected, the AI-generated SQL runs
against this throwaway database so the full pipeline works without a real DB.
"""
from __future__ import annotations

import sqlite3
from typing import Any

from app.ai.schema_introspector import format_schema_for_prompt
from app.core.exceptions import InvalidSQLError

DEMO_SCHEMA: dict[str, list[str]] = {
    "sales": [
        "id", "product_name", "category", "revenue",
        "quantity", "sale_date", "region",
    ],
    "customers": ["id", "name", "email", "country", "signup_date", "total_spent"],
    "products": ["id", "name", "category", "price", "stock_quantity"],
}

_CATEGORIES = ["Electronics", "Clothing", "Home", "Sports", "Books"]
_REGIONS = ["North", "South", "East", "West", "Central"]
_COUNTRIES = ["Azerbaijan", "Turkey", "Georgia", "Germany", "USA"]
_MONTHS = [f"2024-{m:02d}" for m in range(1, 13)]


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
        " revenue REAL, quantity INTEGER, sale_date TEXT, region TEXT)"
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
        revenue = round(p[3] * qty * (1 + (i % 5) * 0.1), 2)
        sales.append(
            (
                sid,
                p[1],  # product_name
                p[2],  # category
                revenue,
                qty,
                _MONTHS[i % 12] + "-15",
                _REGIONS[i % len(_REGIONS)],
            )
        )
        sid += 1
    cur.executemany("INSERT INTO sales VALUES (?,?,?,?,?,?,?)", sales)

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
    conn.commit()


def format_demo_schema() -> str:
    """Schema text for the Text2SQL prompt."""
    schema = {
        table: [{"name": col, "type": "TEXT/NUMERIC"} for col in cols]
        for table, cols in DEMO_SCHEMA.items()
    }
    return format_schema_for_prompt(schema)


def execute_demo_sql(sql: str) -> tuple[list[str], list[dict[str, Any]]]:
    """Run the SELECT against a freshly seeded in-memory database."""
    conn = sqlite3.connect(":memory:")
    try:
        _seed(conn)
        conn.row_factory = sqlite3.Row
        cur = conn.execute(sql)
        rows = cur.fetchall()
        columns = [d[0] for d in cur.description] if cur.description else []
        return columns, [dict(r) for r in rows]
    except sqlite3.Error as exc:
        raise InvalidSQLError("Demo SQL icra olunmadı.", detail=str(exc)) from exc
    finally:
        conn.close()
