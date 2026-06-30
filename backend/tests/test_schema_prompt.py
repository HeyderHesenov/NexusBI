"""Text2SQL schema prompt — real types + sample values (engine quality)."""
from __future__ import annotations

from app.db import demo_data


def test_demo_schema_has_real_types_and_samples():
    text = demo_data.format_demo_schema()
    # Real types (not the old "TEXT/NUMERIC" placeholder).
    assert "TEXT/NUMERIC" not in text
    assert "revenue (NUMERIC)" in text
    assert "region (TEXT)" in text
    # Sample values give the model concrete filter literals.
    assert "e.g." in text
    assert "North" in text  # a real region sample
    assert "Electronics" in text  # a real category sample


def test_demo_sales_has_customer_id():
    """customer_id enables realistic customer↔sales joins."""
    from app.db.demo_data import DEMO_SCHEMA

    assert "customer_id" in DEMO_SCHEMA["sales"]
    # And it actually joins to customers.
    _c, rows = demo_data.execute_demo_sql(
        "SELECT COUNT(*) AS n FROM sales s JOIN customers c ON s.customer_id = c.id"
    )
    assert rows[0]["n"] == 300  # every sale maps to a customer
