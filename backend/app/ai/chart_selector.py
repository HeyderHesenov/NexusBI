"""Pick an optimal chart type for a query result."""
from __future__ import annotations

import json
from typing import Any

from app.ai.client import chat_json
from app.ai.prompt_templates import CHART_SELECTOR_PROMPT, CHART_SELECTOR_USER_PROMPT
from app.ai.types import ChartConfig
from app.core.logging import get_logger

_NUMERIC = (int, float)
_log = get_logger("nexusbi.ai")

# A pie with more than this many slices is unreadable; fall back to a bar chart
# (which supports scrolling/zoom + drill-down) instead.
_MAX_PIE_SLICES = 8


def _rule_based(columns: list[str], data: list[dict[str, Any]]) -> ChartConfig:
    """Deterministic fallback when the LLM is unavailable."""
    if not columns:
        return ChartConfig(chart_type="table")

    if len(data) == 1 and len(columns) == 1:
        return ChartConfig(chart_type="kpi_card", y_axis=columns[0])

    sample = data[0] if data else {}
    numeric = [c for c in columns if isinstance(sample.get(c), _NUMERIC)]
    categorical = [c for c in columns if c not in numeric]

    if len(columns) == 2 and numeric and categorical:
        cat = categorical[0]
        if len(data) <= _MAX_PIE_SLICES:
            return ChartConfig(chart_type="pie", x_axis=cat, y_axis=numeric[0])
        is_time = any(k in cat.lower() for k in ("date", "month", "year", "day", "time"))
        ctype = "line" if is_time else "bar"
        return ChartConfig(chart_type=ctype, x_axis=cat, y_axis=numeric[0])

    return ChartConfig(chart_type="table")


async def select_chart_type(
    columns: list[str], data: list[dict[str, Any]], nl_query: str
) -> ChartConfig:
    """LLM-driven selection with a rule-based fallback."""
    try:
        user = CHART_SELECTOR_USER_PROMPT.format(
            nl_query=nl_query,
            columns=json.dumps(columns, ensure_ascii=False),
            sample=json.dumps(data[:3], ensure_ascii=False, default=str),
            row_count=len(data),
        )
        raw = await chat_json(CHART_SELECTOR_PROMPT, user)
        return _guard_pie(ChartConfig(**raw), data)
    except Exception as exc:  # noqa: BLE001 — degrade to deterministic selection
        _log.warning("chart_selection_failed", error=type(exc).__name__, detail=str(exc)[:200])
        return _rule_based(columns, data)


def _guard_pie(config: ChartConfig, data: list[dict[str, Any]]) -> ChartConfig:
    """Demote a pie with too many slices to a bar — pies are unreadable past ~8."""
    if config.chart_type == "pie" and len(data) > _MAX_PIE_SLICES:
        _log.info("pie_demoted_to_bar", slices=len(data))
        config.chart_type = "bar"
    return config
