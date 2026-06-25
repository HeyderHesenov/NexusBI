"""AI-powered anomaly detection and forecasting over query results."""
from __future__ import annotations

import json
from typing import Any

from app.ai.client import chat_json
from app.ai.prompt_templates import (
    ANOMALY_DETECTOR_PROMPT,
    ANOMALY_DETECTOR_USER_PROMPT,
    FORECAST_PROMPT,
    FORECAST_USER_PROMPT,
)
from app.core.exceptions import AIGenerationError

_NUMERIC = (int, float)
_MAX_ROWS = 200


def pick_series(columns: list[str], rows: list[dict[str, Any]]) -> tuple[str, str]:
    """Return (label_column, value_column) for a 1-D series, or raise."""
    if not rows or not columns:
        raise AIGenerationError("Təhlil üçün data yoxdur.")
    sample = rows[0]
    numeric = [c for c in columns if isinstance(sample.get(c), _NUMERIC)]
    if not numeric:
        raise AIGenerationError("Təhlil üçün ədədi sütun tapılmadı.")
    value_col = numeric[0]
    label_col = next((c for c in columns if c != value_col), columns[0])
    return label_col, value_col


async def detect_anomalies(
    columns: list[str], rows: list[dict[str, Any]], nl_query: str
) -> dict[str, Any]:
    """Flag anomalous points in the result series via the LLM."""
    label_col, value_col = pick_series(columns, rows)
    user = ANOMALY_DETECTOR_USER_PROMPT.format(
        nl_query=nl_query,
        label_col=label_col,
        value_col=value_col,
        data=json.dumps(rows[:_MAX_ROWS], ensure_ascii=False, default=str),
    )
    try:
        raw = await chat_json(ANOMALY_DETECTOR_PROMPT, user)
    except Exception as exc:  # noqa: BLE001
        raise AIGenerationError("Anomaliya təhlili alınmadı.") from exc
    return {
        "anomalies": raw.get("anomalies", []),
        "summary": raw.get("summary", ""),
        "label_col": label_col,
        "value_col": value_col,
    }


async def forecast(
    columns: list[str], rows: list[dict[str, Any]], nl_query: str, periods: int
) -> dict[str, Any]:
    """Project the next `periods` points of the result series via the LLM."""
    label_col, value_col = pick_series(columns, rows)
    user = FORECAST_USER_PROMPT.format(
        nl_query=nl_query,
        label_col=label_col,
        value_col=value_col,
        periods=periods,
        data=json.dumps(rows[:_MAX_ROWS], ensure_ascii=False, default=str),
    )
    try:
        raw = await chat_json(FORECAST_PROMPT.format(periods=periods), user)
    except Exception as exc:  # noqa: BLE001
        raise AIGenerationError("Proqnoz alınmadı.") from exc
    return {
        "forecast": raw.get("forecast", []),
        "narrative": raw.get("narrative", ""),
        "label_col": label_col,
        "value_col": value_col,
    }
