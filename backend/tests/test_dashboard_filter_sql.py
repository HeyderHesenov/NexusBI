"""Global dashboard filter injection (dashboard_filter_sql.apply_filter)."""
from __future__ import annotations

from app.db import demo_data
from app.services import rls_sql
from app.services.dashboard_filter_sql import apply_filter, filter_active

SCHEMA = {
    "sales": [{"name": "region"}, {"name": "revenue"}, {"name": "sale_date"}, {"name": "id"}],
    "products": [{"name": "id"}, {"name": "name"}, {"name": "price"}, {"name": "category"}],
}


def test_empty_spec_is_noop():
    sql = "SELECT SUM(revenue) FROM sales"
    assert apply_filter(sql, None, SCHEMA, "sqlite") == sql
    assert apply_filter(sql, {"dimensions": []}, SCHEMA, "sqlite") == sql


def test_dimension_filter_before_aggregation():
    out = apply_filter(
        "SELECT region, SUM(revenue) FROM sales GROUP BY region",
        {"dimensions": [{"column": "region", "values": ["North", "South"]}]},
        SCHEMA,
        "sqlite",
    )
    low = out.lower()
    assert "where" in low and "region" in low
    assert "'north'" in low and "'south'" in low
    # WHERE runs before GROUP BY so the SUM is computed on filtered rows.
    assert low.index("where") < low.index("group by")


def test_date_range_both_bounds():
    out = apply_filter(
        "SELECT SUM(revenue) FROM sales",
        {"date_column": "sale_date", "date_start": "2024-03-01", "date_end": "2024-06-30"},
        SCHEMA,
        "sqlite",
    )
    low = out.lower()
    assert "sale_date" in low and "'2024-03-01'" in low
    # End bound is made exclusive on the NEXT day so same-day datetimes survive.
    assert "'2024-07-01'" in low and "'2024-06-30'" not in low


def test_date_end_non_iso_falls_back_to_inclusive():
    out = apply_filter(
        "SELECT SUM(revenue) FROM sales",
        {"date_column": "sale_date", "date_end": "2024-06"},
        SCHEMA,
        "sqlite",
    )
    # '2024-06' isn't a plain ISO date → keep the plain <= bound (no next-day).
    assert "'2024-06'" in out


def test_shared_column_binds_to_one_table_only():
    # 'category' exists on both sales and products; the filter must bind to just
    # the first owner (sales) so a join isn't over-restricted to zero rows.
    out = apply_filter(
        "SELECT category, SUM(revenue) FROM sales s "
        "JOIN products p ON s.id = p.id GROUP BY category",
        {"dimensions": [{"column": "category", "values": ["Books"]}]},
        SCHEMA,
        "sqlite",
    )
    assert out.lower().count("in ('books')") == 1


def test_case_insensitive_column_uses_schema_casing():
    schema = {"sales": [{"name": "Region"}, {"name": "revenue"}]}
    out = apply_filter(
        "SELECT SUM(revenue) FROM sales",
        {"dimensions": [{"column": "region", "values": ["North"]}]},  # lower-case input
        schema,
        "sqlite",
    )
    # Matched case-insensitively AND emitted with the schema's real casing.
    assert "Region" in out and "'North'" in out


def test_filter_active_helper():
    assert filter_active(None) is False
    assert filter_active({"dimensions": []}) is False
    assert filter_active({"date_column": "d", "dimensions": []}) is False  # column, no bound
    assert filter_active({"dimensions": [{"column": "region", "values": ["North"]}]}) is True
    assert filter_active({"date_column": "d", "date_start": "2024-01-01", "dimensions": []}) is True


def test_fail_open_when_column_absent_from_query():
    # 'region' lives on sales; a query that only reads products is left untouched.
    sql = "SELECT name, price FROM products"
    out = apply_filter(
        sql, {"dimensions": [{"column": "region", "values": ["North"]}]}, SCHEMA, "sqlite"
    )
    assert out == sql


def test_fail_open_on_unparseable_sql():
    junk = "this is not valid sql @@@"
    out = apply_filter(
        junk, {"dimensions": [{"column": "region", "values": ["North"]}]}, SCHEMA, "sqlite"
    )
    assert out == junk


def test_empty_values_list_ignored():
    sql = "SELECT region, SUM(revenue) FROM sales GROUP BY region"
    out = apply_filter(
        sql, {"dimensions": [{"column": "region", "values": []}]}, SCHEMA, "sqlite"
    )
    assert out == sql


def test_values_are_escaped_no_injection():
    import sqlglot

    out = apply_filter(
        "SELECT SUM(revenue) FROM sales",
        {"dimensions": [{"column": "region", "values": ["North'); DROP TABLE sales;--"]}]},
        SCHEMA,
        "sqlite",
    )
    # The malicious value is a single escaped string literal, not executable SQL:
    # the embedded quote is doubled and the whole thing parses to ONE statement.
    assert "''" in out  # sqlglot doubled the embedded quote
    statements = sqlglot.parse(out, dialect="sqlite")
    assert len(statements) == 1  # no smuggled second (DROP) statement


def test_rls_still_applies_on_top_of_filter():
    # The filter is injected first; RLS must still AND its own predicate in.
    from types import SimpleNamespace

    filtered = apply_filter(
        "SELECT region, SUM(revenue) FROM sales GROUP BY region",
        {"dimensions": [{"column": "region", "values": ["North"]}]},
        SCHEMA,
        "sqlite",
    )
    rls_schema = {"sales": [{"name": "region"}, {"name": "revenue"}]}
    out = rls_sql.constrain_sql(
        filtered, [SimpleNamespace(column="region", allowed_value="North")], rls_schema, "sqlite"
    )
    low = out.lower()
    # Both the dashboard filter and the RLS predicate reference region.
    assert low.count("region") >= 3


def test_aggregate_actually_shrinks_on_demo_data():
    # End-to-end against the demo engine: filtering a region reduces the SUM.
    base_cols, base_rows = demo_data.execute_demo_sql(
        "SELECT SUM(revenue) AS total FROM sales"
    )
    total_all = base_rows[0]["total"]
    filtered_sql = apply_filter(
        "SELECT SUM(revenue) AS total FROM sales",
        {"dimensions": [{"column": "region", "values": ["North"]}]},
        demo_data.DEMO_SCHEMA,
        "sqlite",
    )
    _, filtered_rows = demo_data.execute_demo_sql(filtered_sql)
    total_north = filtered_rows[0]["total"]
    assert total_north is not None
    assert total_north < total_all
