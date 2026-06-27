"""Chart selection: pie guard for high cardinality + rule-based threshold."""
from __future__ import annotations

import pytest

from app.ai import chart_selector
from app.ai.types import ChartConfig


def _rows(n: int) -> list[dict]:
    return [{"name": f"c{i}", "total": float(i + 1)} for i in range(n)]


@pytest.mark.asyncio
async def test_ai_pie_demoted_to_bar_when_too_many(monkeypatch):
    async def fake_chat_json(system, user, *, temperature=0.0):
        return {"chart_type": "pie", "x_axis": "name", "y_axis": "total"}

    monkeypatch.setattr(chart_selector, "chat_json", fake_chat_json)
    cfg = await chart_selector.select_chart_type(["name", "total"], _rows(20), "id üzrə cəm")
    assert cfg.chart_type == "bar"
    # Axes are preserved on demotion.
    assert cfg.x_axis == "name" and cfg.y_axis == "total"


@pytest.mark.asyncio
async def test_ai_pie_kept_when_few(monkeypatch):
    async def fake_chat_json(system, user, *, temperature=0.0):
        return {"chart_type": "pie", "x_axis": "name", "y_axis": "total"}

    monkeypatch.setattr(chart_selector, "chat_json", fake_chat_json)
    cfg = await chart_selector.select_chart_type(["name", "total"], _rows(5), "region üzrə gəlir")
    assert cfg.chart_type == "pie"


def test_guard_pie_is_noop_for_non_pie():
    cfg = ChartConfig(chart_type="bar", x_axis="name", y_axis="total")
    assert chart_selector._guard_pie(cfg, _rows(50)).chart_type == "bar"


def test_rule_based_pie_threshold():
    # ≤8 categories → pie; >8 → bar.
    assert chart_selector._rule_based(["name", "total"], _rows(8)).chart_type == "pie"
    assert chart_selector._rule_based(["name", "total"], _rows(9)).chart_type == "bar"
