"""Generate a short narrative insight from query results."""
from __future__ import annotations

import json
from typing import Any

from app.ai.client import chat_text
from app.ai.prompt_templates import INSIGHT_GENERATOR_PROMPT, INSIGHT_GENERATOR_USER_PROMPT
from app.ai.types import ChartConfig


async def generate_insight(
    data: list[dict[str, Any]], nl_query: str, chart_config: ChartConfig
) -> str:
    """Return 2-3 sentence insight; empty string on failure or no data."""
    if not data:
        return ""
    try:
        user = INSIGHT_GENERATOR_USER_PROMPT.format(
            nl_query=nl_query,
            chart_type=chart_config.chart_type,
            data=json.dumps(data[:50], ensure_ascii=False, default=str),
        )
        return await chat_text(INSIGHT_GENERATOR_PROMPT, user)
    except Exception:
        return ""
