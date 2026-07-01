"""Hierarchical root-cause decomposition ("Why?") over a query result.

Unlike ``analysis.explain`` (a flat one-level driver summary), this builds a
multi-level decomposition tree the UI renders interactively. AI-first with a
deterministic rule-based fallback so it still works offline / keyless.
"""
from __future__ import annotations

import json
from typing import Any

from pydantic import ValidationError

from app.ai import analysis
from app.ai.client import chat_json
from app.ai.prompt_templates import ROOT_CAUSE_PROMPT, ROOT_CAUSE_USER_PROMPT
from app.core.exceptions import AIGenerationError
from app.core.logging import get_logger
from app.schemas.analysis import RootCauseResponse

_log = get_logger("nexusbi.ai")
_MAX_ROWS = 200
_TOP_N = 8


def _num(v: Any) -> float | None:
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return float(v)
    return None


def _rule_based(
    label_col: str, value_col: str, rows: list[dict[str, Any]]
) -> dict[str, Any]:
    """Deterministic single-level decomposition by magnitude."""
    pairs: list[tuple[str, float]] = []
    for r in rows:
        v = _num(r.get(value_col))
        if v is not None:
            pairs.append((str(r.get(label_col, "—")), v))
    # Share is over total MAGNITUDE so percentages stay positive and sum to ~100%
    # even for mixed-sign series (e.g. profit with loss-making segments); sign is
    # conveyed via ``direction``/``value`` instead.
    total_mag = sum(abs(v) for _, v in pairs) or 1.0
    signed_total = sum(v for _, v in pairs)
    pairs.sort(key=lambda p: abs(p[1]), reverse=True)
    drivers = [
        {
            "label": label,
            "value": round(v, 2),
            "contribution_pct": round(abs(v) / total_mag * 100, 1),
            "direction": "up" if v >= 0 else "down",
            "children": [],
        }
        for label, v in pairs[:_TOP_N]
    ]
    summary = (
        f"{drivers[0]['label']} ən böyük töhfəni verir (~{drivers[0]['contribution_pct']}%)."
        if drivers
        else "Aydın driver tapılmadı."
    )
    return {
        "metric": value_col,
        "total": round(signed_total, 2),
        "summary": summary,
        "drivers": drivers,
    }


async def decompose(
    columns: list[str], rows: list[dict[str, Any]], nl_query: str
) -> dict[str, Any]:
    """Build a root-cause decomposition tree for the result series.

    AI-first; on any AI failure falls back to the deterministic decomposition so
    the feature degrades gracefully instead of erroring.
    """
    label_col, value_col = analysis.pick_series(columns, rows)  # raises if no numeric col
    try:
        user = ROOT_CAUSE_USER_PROMPT.format(
            nl_query=nl_query,
            label_col=label_col,
            value_col=value_col,
            data=json.dumps(rows[:_MAX_ROWS], ensure_ascii=False, default=str),
        )
        raw = await chat_json(ROOT_CAUSE_PROMPT, user, localize=True)
        drivers = raw.get("drivers")
        if isinstance(drivers, list) and drivers:
            candidate = {
                "metric": raw.get("metric") or value_col,
                "total": raw.get("total"),
                "summary": raw.get("summary", ""),
                "drivers": drivers,
            }
            # Validate the AI shape HERE so malformed nodes fall back gracefully
            # instead of raising a 500 at the response-model boundary.
            return RootCauseResponse(**candidate).model_dump()
    except (AIGenerationError, ValidationError) as exc:
        _log.warning("root_cause_ai_unusable", detail=str(exc)[:200])
    except Exception as exc:  # noqa: BLE001 — fall back, never fatal
        _log.warning("root_cause_failed", error=type(exc).__name__, detail=str(exc)[:200])
    return _rule_based(label_col, value_col, rows)
