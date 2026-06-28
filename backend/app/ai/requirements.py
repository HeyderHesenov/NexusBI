"""Extract measurable KPIs from a requirements document (BRD / user story).

AI-first with a deterministic rule-based fallback so the requirements→dashboard
flow still works offline / without an API key.
"""
from __future__ import annotations

import re
from typing import Any

from app.ai.client import chat_json
from app.ai.prompt_templates import REQUIREMENTS_PROMPT, REQUIREMENTS_USER_PROMPT
from app.core.logging import get_logger

_log = get_logger("nexusbi.ai")
_MAX_CHARS = 12000  # cap prompt size
_MAX_KPIS = 8

# Lines hinting at something measurable (AZ + EN), used by the offline fallback.
_METRIC_HINTS = re.compile(
    r"(gəlir|satış|sayı|say\b|faiz|nisbət|trend|orta|cəm|ən çox|ən az|top|"
    r"revenue|sales|count|number|rate|ratio|percent|%|total|average|avg|"
    r"churn|conversion|growth|kpi|metr)",
    re.IGNORECASE,
)


def _clean(text: str) -> str:
    return (text or "").strip()[:_MAX_CHARS]


def _rule_based(text: str) -> dict[str, Any]:
    """Pick measurable-looking lines and turn each into a KPI question."""
    kpis: list[dict[str, str]] = []
    seen: set[str] = set()
    for raw in re.split(r"[\n\r]+|(?<=[.!?])\s+", text):
        # Strip only a leading bullet / list-numbering prefix (not digits that are
        # part of the metric itself, e.g. "Top 5 products" / "2024 revenue").
        line = re.sub(r"^\s*(?:[-•*]+|\d+[.)])\s*", "", raw).strip()
        if len(line) < 6 or not _METRIC_HINTS.search(line):
            continue
        key = line.lower()
        if key in seen:
            continue
        seen.add(key)
        short = line[:60]
        kpis.append(
            {
                "name": short,
                "question": line if line.endswith("?") else f"{line} — göstər",
                "rationale": "Tələb sənədindən çıxarıldı.",
                "requirement_ref": short,
            }
        )
        if len(kpis) >= _MAX_KPIS:
            break
    return {"kpis": kpis}


async def extract_kpis(text: str) -> dict[str, Any]:
    """Return {"kpis": [{name, question, rationale, requirement_ref}, ...]}."""
    cleaned = _clean(text)
    if not cleaned:
        return {"kpis": []}
    try:
        raw = await chat_json(
            REQUIREMENTS_PROMPT, REQUIREMENTS_USER_PROMPT.format(text=cleaned)
        )
        kpis = raw.get("kpis")
        if isinstance(kpis, list) and kpis:
            # Keep only well-formed entries; cap the count.
            out = [
                {
                    "name": str(k.get("name") or k.get("question") or "KPI")[:120],
                    "question": str(k.get("question") or k.get("name") or "").strip(),
                    "rationale": str(k.get("rationale") or "")[:500],
                    "requirement_ref": str(k.get("requirement_ref") or "")[:500],
                }
                for k in kpis
                if isinstance(k, dict) and (k.get("question") or k.get("name"))
            ]
            out = [k for k in out if k["question"]][:_MAX_KPIS]
            if out:
                return {"kpis": out}
    except Exception as exc:  # noqa: BLE001 — fall back, never fatal
        _log.warning("requirements_ai_failed", error=type(exc).__name__, detail=str(exc)[:200])
    return _rule_based(cleaned)
