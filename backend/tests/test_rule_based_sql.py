"""Rule-based offline SQL fallback — generated SQL must run on the demo data."""
from __future__ import annotations

import pytest

from app.ai import rule_based_sql
from app.db import demo_data


def _run(nl: str):
    result = rule_based_sql.generate_sql_fallback(nl)
    columns, rows = demo_data.execute_demo_sql(result.sql)
    return result, columns, rows


@pytest.mark.parametrize(
    "nl",
    [
        "top 5 products by revenue",
        "ən çox satan məhsullar",
        "revenue by category",
        "kateqoriya üzrə gəlir",
        "sales by region",
        "revenue by month",
        "how many customers",
        "neçə müştəri var",
        "customers by country",
        "total revenue",
        "ümumi gəlir",
        "show me everything",
        "asdf qwerty",
        # Regression: region only exists on sales — must not leak onto other tables.
        "customers by region",
        "products by region",
        "müştərilər bölgə üzrə",
    ],
)
def test_fallback_sql_is_runnable(nl):
    """Every supported phrasing must yield SQL that executes without error."""
    result, columns, rows = _run(nl)
    assert result.sql.lower().startswith("select")
    assert columns  # at least one column came back


def test_top_n_limit_respected():
    _, _, rows = _run("top 3 products by revenue")
    assert len(rows) <= 3


def test_revenue_by_category_groups():
    _, columns, rows = _run("revenue by category")
    assert "category" in columns
    assert "total_revenue" in columns
    # Demo seeds 5 categories.
    assert 1 <= len(rows) <= 5


@pytest.mark.parametrize("nl", ["revenue by month", "ay üzrə gəlir"])
def test_revenue_by_month_is_chronological(nl):
    """A time trend must read left→right in calendar order, not ranked by revenue."""
    result, columns, rows = _run(nl)
    assert "month" in columns
    assert "order by substr(sale_date, 1, 7) asc" in result.sql.lower()
    months = [r["month"] for r in rows]
    assert months == sorted(months)  # ISO YYYY-MM sorts lexicographically = chronologically
    assert months == sorted(set(months))  # one row per month, still ascending


@pytest.mark.parametrize("nl", ["visits by date", "ziyarətlər gün üzrə"])
def test_events_by_date_is_chronological(nl):
    """A daily events trend must read chronologically, not ranked by count."""
    result, columns, rows = _run(nl)
    assert "event_date" in columns
    assert "order by event_date asc" in result.sql.lower()
    dates = [r["event_date"] for r in rows]
    assert dates == sorted(dates)  # ISO YYYY-MM-DD sorts lexicographically = chronologically


def test_count_customers():
    _, columns, rows = _run("how many customers")
    assert len(rows) == 1
    assert list(rows[0].values())[0] == 60  # demo seeds 60 customers


def test_default_preview_is_bounded():
    _, _, rows = _run("just show data")
    assert len(rows) <= 50


def test_products_by_revenue_uses_sales():
    """A sales metric must route to the sales table, ordering by revenue."""
    result, columns, _ = _run("top 5 products by revenue")
    assert "sales" in result.sql.lower()
    assert "revenue" in result.sql.lower()
    assert "product_name" in columns
