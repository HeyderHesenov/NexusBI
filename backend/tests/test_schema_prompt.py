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
