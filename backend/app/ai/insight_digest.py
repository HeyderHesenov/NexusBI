"""Proactive 'smart insight' detection over query results."""
from __future__ import annotations

import json
from typing import Any

from app.ai.client import chat_json
from app.ai.prompt_templates import INSIGHT_DIGEST_PROMPT, INSIGHT_DIGEST_USER_PROMPT
from app.core.logging import get_logger

_log = get_logger("nexusbi.ai")
_MAX_ROWS = 50


async def summarize_change(
    nl_query: str,
    prev_rows: list[dict[str, Any]],
    curr_rows: list[dict[str, Any]],
) -> str | None:
    """Return a one-line notable insight, or None if nothing stands out.

    ``prev_rows`` may be empty (first run / single snapshot) — the model then
    judges the current result on its own.
    """
    if not curr_rows:
        return None
    try:
        user = INSIGHT_DIGEST_USER_PROMPT.format(
            nl_query=nl_query,
            prev=json.dumps(prev_rows[:_MAX_ROWS], ensure_ascii=False, default=str),
            curr=json.dumps(curr_rows[:_MAX_ROWS], ensure_ascii=False, default=str),
        )
        raw = await chat_json(INSIGHT_DIGEST_PROMPT, user, temperature=0.2, localize=True)
        if raw.get("notable") and isinstance(raw.get("insight"), str) and raw["insight"].strip():
            return raw["insight"].strip()
        return None
    except Exception as exc:  # noqa: BLE001 — best-effort, never fatal
        _log.warning("insight_digest_failed", error=type(exc).__name__, detail=str(exc)[:200])
        return None
