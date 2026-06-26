"""Generate a short narrative insight from query results."""
from __future__ import annotations

import json
from typing import Any

from app.ai.client import chat_text
from app.ai.prompt_templates import INSIGHT_GENERATOR_PROMPT, INSIGHT_GENERATOR_USER_PROMPT
from app.core.logging import get_logger

_log = get_logger("nexusbi.ai")


async def generate_insight(
    data: list[dict[str, Any]], nl_query: str, chart_type: str = ""
) -> str:
    """Return 2-3 sentence insight; empty string on failure or no data.

    Takes only chart_type (not the full config) so it can run concurrently with
    chart selection.
    """
    if not data:
        return ""
    try:
        user = INSIGHT_GENERATOR_USER_PROMPT.format(
            nl_query=nl_query,
            chart_type=chart_type or "auto",
            data=json.dumps(data[:50], ensure_ascii=False, default=str),
        )
        return await chat_text(INSIGHT_GENERATOR_PROMPT, user)
    except Exception as exc:  # noqa: BLE001 — insight is best-effort, never fatal
        _log.warning("insight_generation_failed", error=type(exc).__name__, detail=str(exc)[:200])
        return ""
