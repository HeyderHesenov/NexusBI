"""Schema introspection: foreign-key enrichment (live) + sample rendering (demo-shaped)."""
from __future__ import annotations

from app.ai.schema_introspector import _fmt_col, format_schema_for_prompt, get_schema
from tests.conftest import seed_sqlite_file

_SCHEMA = """
CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, category TEXT);
INSERT INTO products VALUES (1,'Laptop','Electronics'),(2,'Shirt','Clothing');
CREATE TABLE sales (
    id INTEGER PRIMARY KEY,
    product_id INTEGER REFERENCES products(id),
    region TEXT,
    revenue REAL
);
INSERT INTO sales VALUES (1,1,'North',100.0),(2,2,'South',50.0),(3,1,'North',75.0);
"""


async def test_get_schema_has_fk_relationships():
    conn = seed_sqlite_file(_SCHEMA)
    schema = await get_schema(conn)

    assert set(schema) == {"products", "sales"}
    sales = {c["name"]: c for c in schema["sales"]}
    # Foreign key relationship is captured on the constrained column → fixes JOINs.
    assert sales["product_id"]["references"] == "products.id"
    # A column without an FK has no `references` key.
    assert "references" not in sales["region"]


async def test_live_schema_does_not_leak_row_values():
    # Row VALUES must NOT be sampled from a live source (RLS/multi-tenant leak risk).
    conn = seed_sqlite_file(_SCHEMA)
    schema = await get_schema(conn)
    for cols in schema.values():
        for c in cols:
            assert "samples" not in c


async def test_prompt_renders_fk_arrow():
    conn = seed_sqlite_file(_SCHEMA)
    prompt = format_schema_for_prompt(await get_schema(conn))
    assert "→ products.id" in prompt


def test_fmt_col_renders_samples_when_present():
    # Demo schema supplies safe (synthetic) sample values; _fmt_col renders them.
    out = _fmt_col({"name": "region", "type": "TEXT", "samples": ["North", "South"]})
    assert "e.g. North, South" in out
    # And FK + samples together.
    out2 = _fmt_col({"name": "product_id", "type": "INTEGER", "references": "products.id"})
    assert "→ products.id" in out2
