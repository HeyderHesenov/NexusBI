"""DAX subset -> SQL translation + mock provider execution."""
from __future__ import annotations

import pytest

from app.core.exceptions import InvalidSQLError
from app.db import demo_data
from app.services.powerbi import dax
from app.services.powerbi.provider import MockPowerBIProvider


def _run(dax_query: str):
    sql = dax.dax_to_sql(dax_query)
    columns, rows = demo_data.execute_demo_sql(sql)
    return sql, columns, rows


def test_evaluate_table():
    sql, _, rows = _run("EVALUATE 'Sales'")
    assert sql.lower().startswith("select * from sales")
    assert len(rows) <= 10000 and rows


def test_summarizecolumns_group_and_measure():
    sql, columns, rows = _run(
        "EVALUATE SUMMARIZECOLUMNS('Sales'[category], \"Total Revenue\", SUM('Sales'[revenue]))"
    )
    assert "group by category" in sql.lower()
    assert "category" in columns
    assert "Total Revenue" in columns
    assert 1 <= len(rows) <= 5


def test_topn_orders_and_limits():
    sql, columns, rows = _run(
        "EVALUATE TOPN(3, SUMMARIZECOLUMNS('Sales'[product_name], "
        '"Total Revenue", SUM(\'Sales\'[revenue])), [Total Revenue], DESC)'
    )
    assert "order by" in sql.lower()
    assert sql.strip().lower().endswith("limit 3")
    assert len(rows) <= 3
    # Descending by the measure.
    vals = [r["Total Revenue"] for r in rows]
    assert vals == sorted(vals, reverse=True)


def test_count_measure():
    _, columns, rows = _run(
        "EVALUATE SUMMARIZECOLUMNS('Customers'[country], \"Count\", COUNTROWS('Customers'))"
    )
    assert "country" in columns and "Count" in columns
    assert sum(r["Count"] for r in rows) == 60


def test_trailing_order_by():
    sql, _, rows = _run(
        "EVALUATE SUMMARIZECOLUMNS('Sales'[region], \"Rev\", SUM('Sales'[revenue])) "
        "ORDER BY [Rev] ASC"
    )
    assert "order by" in sql.lower()
    vals = [r["Rev"] for r in rows]
    assert vals == sorted(vals)


@pytest.mark.parametrize(
    "bad",
    [
        "SELECT * FROM sales",          # not DAX
        "EVALUATE FILTER('Sales', 1)",  # unsupported function
        "EVALUATE SUMMARIZECOLUMNS('Ghost'[x], \"m\", SUM('Ghost'[y]))",  # unknown table
    ],
)
def test_unsupported_dax_raises(bad):
    with pytest.raises(InvalidSQLError):
        dax.dax_to_sql(bad)


async def test_mock_provider_execute():
    provider = MockPowerBIProvider()
    datasets = await provider.list_datasets()
    assert datasets and datasets[0]["id"] == "sales-model"
    schema = await provider.get_model_schema("sales-model")
    assert "Sales" in schema
    columns, rows = await provider.execute_dax(
        "sales-model",
        "EVALUATE SUMMARIZECOLUMNS('Sales'[category], \"Rev\", SUM('Sales'[revenue]))",
    )
    assert "category" in columns and rows
