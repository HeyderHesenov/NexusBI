"""Plan a set of analytical questions that together build a dashboard."""
from __future__ import annotations

from app.ai.client import chat_json
from app.ai.prompt_templates import DASHBOARD_PLANNER_PROMPT, DASHBOARD_PLANNER_USER_PROMPT
from app.core.logging import get_logger

_log = get_logger("nexusbi.ai")

_DEMO_HINT = "Demo verilənləri: sales (satışlar), customers (müştərilər), products (məhsullar)."
_MAX_QUESTIONS = 6


async def plan_dashboard(goal: str, schema_hint: str = "") -> list[str]:
    """Return 4–6 distinct NL questions covering ``goal``; [] on failure."""
    try:
        user = DASHBOARD_PLANNER_USER_PROMPT.format(
            goal=goal, schema_hint=schema_hint or _DEMO_HINT
        )
        raw = await chat_json(DASHBOARD_PLANNER_PROMPT, user, temperature=0.4)
        questions = [q.strip() for q in raw.get("questions", []) if isinstance(q, str) and q.strip()]
        return questions[:_MAX_QUESTIONS]
    except Exception as exc:  # noqa: BLE001 — caller decides how to degrade
        _log.warning("dashboard_plan_failed", error=type(exc).__name__, detail=str(exc)[:200])
        return []
