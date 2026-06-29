"""RLS predicate injection (rls_sql.constrain_sql) — SQL-level enforcement."""
from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.core.exceptions import InvalidSQLError
from app.services.rls_sql import constrain_sql

SCHEMA = {
    "sales": [{"name": "region"}, {"name": "revenue"}, {"name": "id"}],
    "users": [{"name": "id"}, {"name": "name"}],
}


def _rule(column: str, value: str) -> SimpleNamespace:
    return SimpleNamespace(column=column, allowed_value=value)


def test_no_rules_is_noop():
    sql = "SELECT SUM(revenue) FROM sales"
    assert constrain_sql(sql, [], SCHEMA, "sqlite") == sql


def test_aggregate_is_filtered_before_aggregation():
    # The core defect: a bare SUM must be constrained, not returned whole-tenant.
    out = constrain_sql(
        "SELECT SUM(revenue) AS total FROM sales", [_rule("region", "EU")], SCHEMA, "postgresql"
    )
    low = out.lower()
    assert "where" in low and "region" in low and "'eu'" in low
    # WHERE must precede GROUP/aggregation semantics — it's in the same SELECT.
    assert low.index("where") > low.index("from")


def test_group_by_multi_value_in():
    out = constrain_sql(
        "SELECT region, SUM(revenue) FROM sales GROUP BY region",
        [_rule("region", "EU"), _rule("region", "US")],
        SCHEMA,
        "sqlite",
    )
    assert "'EU', 'US'" in out or "'US', 'EU'" in out
    assert out.lower().index("where") < out.lower().index("group by")


def test_join_predicate_is_qualified_by_alias():
    out = constrain_sql(
        "SELECT s.revenue FROM sales s JOIN users u ON u.id = s.id",
        [_rule("region", "EU")],
        SCHEMA,
        "sqlite",
    )
    # Predicate must target the sales alias, not users.
    assert "s.region" in out.lower().replace('"', "")


def test_subquery_scope_is_constrained():
    out = constrain_sql(
        "SELECT * FROM (SELECT region, revenue FROM sales) t",
        [_rule("region", "EU")],
        SCHEMA,
        "sqlite",
    )
    # The inner scope (which reads sales) carries the predicate.
    inner = out[out.index("(") : out.index(")")]
    assert "where" in inner.lower()


def test_uppercase_table_is_still_constrained():
    # Case-insensitive match: `FROM SALES` reads the same table as `sales` and
    # must NOT bypass RLS (this was a full-bypass bug).
    out = constrain_sql(
        "SELECT SUM(revenue) FROM SALES", [_rule("region", "EU")], SCHEMA, "postgresql"
    )
    low = out.lower()
    assert "where" in low and "region" in low and "'eu'" in low


def test_cte_shadowing_does_not_misinject():
    # `sales` here is a CTE (no region column) — must not get a sales.region
    # predicate; the physical table is shadowed and never read.
    out = constrain_sql(
        "WITH sales AS (SELECT 1 AS revenue) SELECT revenue FROM sales",
        [_rule("region", "EU")],
        SCHEMA,
        "sqlite",
    )
    assert "region" not in out.lower()


def test_real_table_inside_cte_body_is_constrained():
    out = constrain_sql(
        "WITH x AS (SELECT region, revenue FROM sales) SELECT SUM(revenue) FROM x",
        [_rule("region", "EU")],
        SCHEMA,
        "sqlite",
    )
    # The inner read of the physical `sales` carries the predicate.
    assert "region" in out.lower() and "'eu'" in out.lower()


def test_unknown_column_fails_closed():
    with pytest.raises(InvalidSQLError):
        constrain_sql("SELECT * FROM sales", [_rule("ssn", "x")], SCHEMA, "sqlite")


def test_unparseable_sql_fails_closed():
    with pytest.raises(InvalidSQLError):
        constrain_sql("SELEC bad(((", [_rule("region", "EU")], SCHEMA, "sqlite")


def test_value_with_quote_is_escaped_not_injected():
    out = constrain_sql(
        "SELECT SUM(revenue) FROM sales",
        [_rule("region", "E'U")],
        SCHEMA,
        "sqlite",
    )
    # Escaped, single statement — no injection breakout.
    assert out.count(";") == 0
    assert "''" in out  # doubled quote = escaped literal
