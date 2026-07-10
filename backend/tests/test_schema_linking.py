"""Text2SQL schema linking — rank tables by relevance, keep FK targets, and NEVER
embed sampled values. Hermetic: client.embed uses the offline hash embedding."""
from __future__ import annotations

from app.ai import client, schema_linking
from app.ai.schema_introspector import format_schema_for_prompt
from app.config import settings


def _wide_schema() -> dict[str, list[dict[str, str]]]:
    """> SCHEMA_LINK_MIN_TABLES tables: one clear target ('sales'), the rest noise
    with token-disjoint column names so cosine can separate them."""
    schema: dict[str, list[dict[str, str]]] = {
        "sales": [
            {"name": "revenue", "type": "NUMERIC"},
            {"name": "quantity", "type": "INTEGER"},
            {"name": "discount", "type": "NUMERIC"},
            {"name": "product_id", "type": "INTEGER", "references": "products.id"},
        ],
        "products": [{"name": "id", "type": "INTEGER"}, {"name": "title", "type": "TEXT"}],
    }
    for i in range(12):
        schema[f"noise{i}"] = [
            {"name": f"alpha{i}", "type": "TEXT"},
            {"name": f"beta{i}", "type": "TEXT"},
        ]
    return schema


async def test_small_schema_returns_full_schema():
    schema = {"a": [{"name": "x", "type": "INTEGER"}], "b": [{"name": "y", "type": "TEXT"}]}
    assert len(schema) <= settings.SCHEMA_LINK_MIN_TABLES
    out = await schema_linking.select_relevant("anything", schema)
    assert out == format_schema_for_prompt(schema)  # no linking, full context


def test_descriptor_never_includes_sample_values():
    # Descriptors are what get EMBEDDED and cached under a viewer-shared key, so a
    # column carrying real cell samples must NOT leak them into the descriptor text.
    cols = [{"name": "email", "type": "TEXT", "samples": ["secret@corp.com", "ceo@corp.com"]}]
    desc = schema_linking._descriptor("users", cols)
    assert "email" in desc and "TEXT" in desc
    assert "secret@corp.com" not in desc and "ceo@corp.com" not in desc


def test_fk_closure_pulls_in_join_target():
    schema = _wide_schema()
    closure = schema_linking._fk_closure({"sales"}, schema)
    assert "products" in closure  # sales.product_id -> products.id (outbound)


def test_fk_closure_inbound_pulls_fact_referencing_selected_dimension():
    # A fact table that references a SELECTED dimension must be pulled in even though
    # the dimension does not reference it — otherwise the join loses its fact side.
    schema = {
        "customers": [{"name": "id", "type": "INTEGER"}],
        "orders": [
            {"name": "id", "type": "INTEGER"},
            {"name": "customer_id", "type": "INTEGER", "references": "customers.id"},
        ],
    }
    closure = schema_linking._fk_closure({"customers"}, schema)
    assert "orders" in closure  # inbound: orders -> customers


def test_fk_closure_inbound_respects_cap():
    # A hub dimension referenced by many facts must not balloon the subset past the cap.
    schema = {"dim": [{"name": "id", "type": "INTEGER"}]}
    for i in range(20):
        schema[f"fact{i}"] = [{"name": "dim_id", "type": "INTEGER", "references": "dim.id"}]
    closure = schema_linking._fk_closure({"dim"}, schema, max_tables=5)
    assert len(closure) <= 5  # capped, not all 21 tables


def test_render_subset_strips_dangling_fk_pointer():
    # A selected table referencing a table OUTSIDE the subset must not render a
    # `-> hidden.id` pointer (which would invite a hallucinated join to an absent table).
    schema = {
        "sales": [{"name": "product_id", "type": "INTEGER", "references": "products.id"}],
        "products": [{"name": "id", "type": "INTEGER"}],
    }
    out = schema_linking._render_subset(schema, {"sales"})  # products deliberately excluded
    assert "sales(" in out
    assert "products" not in out  # neither the table nor the dangling FK pointer
    assert "->" not in out and "→" not in out


async def test_ranking_selects_relevant_tables_and_fk():
    schema = _wide_schema()  # 14 tables
    # The question shares tokens with 'sales' (and none with the noise tables).
    out = await schema_linking.select_relevant("total revenue quantity discount", schema)
    tables = [ln.split("(", 1)[0] for ln in out.splitlines() if ln.startswith("- ")]
    assert "- sales" in tables      # the relevant table ranks into the top-K
    assert "- products" in tables   # pulled in via FK closure (sales.product_id -> products.id)
    # Linking dropped most of the 14 tables — a bounded subset, not the whole schema.
    assert len(tables) <= settings.SCHEMA_LINK_TOP_K + 1 < len(schema)


async def test_embed_failure_falls_back_to_full(monkeypatch):
    schema = _wide_schema()

    async def boom(texts):
        raise RuntimeError("embed down")

    monkeypatch.setattr(client, "embed", boom)
    out = await schema_linking.select_relevant("total revenue", schema)
    assert out == format_schema_for_prompt(schema)  # fail-open → full schema, no table lost


async def test_dimension_mismatch_falls_back_to_full(monkeypatch):
    # Descriptor and query embeddings disagreeing on dimension (e.g. a real-model
    # cache hit vs a keyless hash fallback) must fail OPEN to the full schema, never
    # raise or emit a garbage subset. The batched descriptor call has len(texts) > 1;
    # the query call has len(texts) == 1 — size the vectors differently per call.
    schema = _wide_schema()

    async def uneven(texts):
        dim = 8 if len(texts) == 1 else 16
        return [[0.1] * dim for _ in texts]

    monkeypatch.setattr(client, "embed", uneven)
    out = await schema_linking.select_relevant("total revenue quantity", schema)
    assert out == format_schema_for_prompt(schema)
