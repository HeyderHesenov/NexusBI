"""NL->DAX engine (mocked AI) + deterministic DAX fallback."""
from __future__ import annotations

import pytest

from app.ai import rule_based_dax, text2dax
from app.core.exceptions import AIGenerationError
from app.db import demo_data
from app.services.powerbi import dax, sample_model


def _executable(dax_query: str):
    """A fallback DAX is only useful if it translates and runs."""
    sql = dax.dax_to_sql(dax_query)
    return demo_data.execute_demo_sql(sql)


@pytest.mark.parametrize(
    "nl",
    [
        "top 5 products by revenue",
        "ən çox satan məhsullar",
        "revenue by category",
        "kateqoriya üzrə gəlir",
        "sales by region",
        "how many customers by country",
        "total revenue",
        "ümumi gəlir",
        "show everything",
        "asdf qwerty",
    ],
)
def test_fallback_dax_is_executable(nl):
    result = rule_based_dax.generate_dax_fallback(nl)
    assert result.dax.upper().startswith("EVALUATE")
    columns, rows = _executable(result.dax)
    assert columns


def test_fallback_top_products_uses_sales_revenue():
    result = rule_based_dax.generate_dax_fallback("top 3 products by revenue")
    assert "'Sales'" in result.dax and "revenue" in result.dax
    _, rows = _executable(result.dax)
    assert len(rows) <= 3


async def test_generate_dax_with_mocked_ai(monkeypatch):
    async def fake_chat_json(system, user, *, temperature=0.0):
        return {
            "dax": "EVALUATE SUMMARIZECOLUMNS('Sales'[category], \"Rev\", SUM('Sales'[revenue]))",
            "explanation": "ok",
            "confidence": 0.9,
        }

    monkeypatch.setattr(text2dax, "chat_json", fake_chat_json)
    engine = text2dax.Text2DAXEngine()
    schema = sample_model.format_model_for_dax_prompt("sales-model")
    result = await engine.generate_dax("kateqoriya üzrə gəlir", schema)
    assert "SUMMARIZECOLUMNS" in result.dax


async def test_generate_dax_invalid_then_raises(monkeypatch):
    async def fake_bad(system, user, *, temperature=0.0):
        return {"dax": "EVALUATE FILTER('Sales', 1)", "explanation": "", "confidence": 0.1}

    monkeypatch.setattr(text2dax, "chat_json", fake_bad)
    engine = text2dax.Text2DAXEngine(max_retries=2)
    with pytest.raises(AIGenerationError):
        await engine.generate_dax("nonsense", "schema")
