"""Text2SQL engine tests (OpenAI mocked)."""
from __future__ import annotations

import pytest

from app.ai import text2sql as t2s
from app.ai.sql_guard import validate_select_only
from app.core.exceptions import AIGenerationError, InvalidSQLError

SCHEMA = "- sales(product_name (TEXT), revenue (NUMERIC), category (TEXT))"


def _patch_response(monkeypatch, payload: dict) -> None:
    async def fake_chat_json(system: str, user: str, **kw) -> dict:
        return payload

    monkeypatch.setattr(t2s, "chat_json", fake_chat_json)


async def test_generate_simple_sql(monkeypatch):
    _patch_response(
        monkeypatch,
        {"sql": "SELECT product_name FROM sales LIMIT 10", "explanation": "x",
         "confidence": 0.9, "warnings": []},
    )
    result = await t2s.Text2SQLEngine().generate_sql("məhsullar", SCHEMA)
    assert result.sql.lower().startswith("select")
    assert result.confidence == 0.9


async def test_generate_aggregation_sql(monkeypatch):
    _patch_response(
        monkeypatch,
        {"sql": "SELECT category, SUM(revenue) AS total FROM sales GROUP BY category",
         "explanation": "agg", "confidence": 0.8, "warnings": []},
    )
    result = await t2s.Text2SQLEngine().generate_sql("kateqoriya gəliri", SCHEMA)
    assert "group by" in result.sql.lower()


async def test_reject_non_select_query(monkeypatch):
    _patch_response(
        monkeypatch,
        {"sql": "DELETE FROM sales", "explanation": "bad", "confidence": 0.9, "warnings": []},
    )
    with pytest.raises(AIGenerationError):
        await t2s.Text2SQLEngine(max_retries=2).generate_sql("hamısını sil", SCHEMA)


async def test_handle_ambiguous_query(monkeypatch):
    _patch_response(
        monkeypatch,
        {"sql": "SELECT * FROM sales LIMIT 10", "explanation": "qeyri-müəyyən",
         "confidence": 0.3, "warnings": ["Sorğu qeyri-müəyyəndir"]},
    )
    result = await t2s.Text2SQLEngine().generate_sql("nəsə göstər", SCHEMA)
    assert result.warnings
    assert result.confidence < 0.5


def test_sql_guard_blocks_writes():
    for bad in ["DELETE FROM t", "DROP TABLE t", "UPDATE t SET x=1", "SELECT 1; DROP TABLE t"]:
        with pytest.raises(InvalidSQLError):
            validate_select_only(bad)
    assert validate_select_only("SELECT 1").lower() == "select 1"
