"""Statistical anomaly detection and forecasting over query results.

Forecast and anomaly detection are DETERMINISTIC statistics (no LLM) — reproducible,
with honest prediction intervals. Only `explain` (root-cause narration) still uses the
LLM. This is deliberate: an "AI forecast" that a model guesses has no confidence and
can't be reproduced; real BI needs math it can stand behind.
"""
from __future__ import annotations

import json
import re
from typing import Any

import numpy as np

from app.ai.client import chat_json
from app.ai.prompt_templates import EXPLAIN_PROMPT, EXPLAIN_USER_PROMPT
from app.core.exceptions import AIGenerationError
from app.services import stats

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


def _future_labels(existing: list[str], periods: int) -> list[str]:
    """Continue the x-axis: increment YYYY-MM month labels, else '+1..+N'."""
    last = existing[-1] if existing else ""
    mm = re.match(r"^(\d{4})-(\d{2})", last)
    if mm:
        year, month = int(mm.group(1)), int(mm.group(2))
        out = []
        for _ in range(periods):
            month += 1
            if month > 12:
                month, year = 1, year + 1
            out.append(f"{year:04d}-{month:02d}")
        return out
    return [f"+{i + 1}" for i in range(periods)]


async def detect_anomalies(
    columns: list[str], rows: list[dict[str, Any]], nl_query: str
) -> dict[str, Any]:
    """Flag anomalous points via the MAD-based modified z-score (robust, no AI)."""
    label_col, value_col = pick_series(columns, rows)
    coerced = [stats.to_float(r.get(value_col)) for r in rows]
    idx = [i for i, v in enumerate(coerced) if v is not None]
    series = [coerced[i] for i in idx]

    flagged = set(stats.zscore_outliers(series))
    mz = stats.modified_zscores(series)
    median = float(np.median(series)) if series else 0.0

    anomalies = []
    for local in sorted(flagged):
        gi = idx[local]
        value = series[local]
        score = mz[local] if local < len(mz) else 0.0
        # Only points already flagged (modified-z > 3.5) reach here → medium or high.
        severity = "high" if score >= 5 else "medium"
        direction = "yuxarı" if value > median else "aşağı"
        anomalies.append({
            "label": str(rows[gi].get(label_col)),
            "value": value,
            "severity": severity,
            "explanation": (
                f"Median {stats.compact_number(median)} — bu nöqtə {direction} {score:.1f} modifikasiyalı-z "
                f"(robust MAD) ilə kənardır."
            ),
        })

    if anomalies:
        summary = f"{len(anomalies)} anomaliya: median-dan >3.5 modifikasiyalı-z kənar (n={len(series)})."
    elif len(series) < 4:
        summary = f"Yalnız {len(series)} ədədi nöqtə — anomaliya üçün az."
    else:
        summary = "Anomaliya tapılmadı — bütün nöqtələr median ətrafında normaldır."

    return {
        "anomalies": anomalies,
        "summary": summary,
        "label_col": label_col,
        "value_col": value_col,
    }


async def forecast(
    columns: list[str], rows: list[dict[str, Any]], nl_query: str, periods: int
) -> dict[str, Any]:
    """Project the next `periods` points statistically (trend + seasonality) with
    an 80% prediction interval — deterministic, no AI."""
    label_col, value_col = pick_series(columns, rows)
    values = [v for v in (stats.to_float(r.get(value_col)) for r in rows) if v is not None]
    if not values:
        raise AIGenerationError("Proqnoz üçün ədədi data yoxdur.")

    fc = stats.forecast_series(values, periods)
    labels = _future_labels([str(r.get(label_col)) for r in rows], periods)
    forecast_points = [
        {"label": labels[i], "value": round(p["yhat"], 4),
         "lower": round(p["lower"], 4), "upper": round(p["upper"], 4)}
        for i, p in enumerate(fc["points"])
    ]

    return {
        "forecast": forecast_points,
        "narrative": _forecast_narrative(values, fc, periods),
        "label_col": label_col,
        "value_col": value_col,
        "method": fc["method"],
    }


def _forecast_narrative(values: list[float], fc: dict, periods: int) -> str:
    """Deterministic, grounded summary of the fitted forecast."""
    if not fc["points"]:
        return "Proqnoz üçün data yoxdur."
    last = values[-1]
    nxt = fc["points"][0]["yhat"]
    end = fc["points"][-1]["yhat"]
    method_label = {
        "naive": "sadə (az nöqtə)",
        "trend": "xətti trend",
    }.get(fc["method"], "trend + mövsümilik")
    parts = [f"{periods} dövrlük {method_label} proqnozu."]
    if last:
        step = (nxt - last) / abs(last) * 100
        parts.append(f"Növbəti dövr ≈ {stats.compact_number(nxt)} ({step:+.1f}%).")
    horizon = (end - last) / abs(last) * 100 if last else 0.0
    parts.append(f"Dövr sonuna ≈ {stats.compact_number(end)} ({horizon:+.1f}%).")
    parts.append(f"±{stats.compact_number(fc['resid_std'] * fc['z'])} 80% interval (qalıq əsaslı).")
    return " ".join(parts)


async def explain(
    columns: list[str], rows: list[dict[str, Any]], nl_query: str
) -> dict[str, Any]:
    """Root-cause: decompose the result into the biggest drivers via the LLM."""
    if not rows or not columns:
        raise AIGenerationError("Təhlil üçün data yoxdur.")
    user = EXPLAIN_USER_PROMPT.format(
        nl_query=nl_query,
        columns=json.dumps(columns, ensure_ascii=False),
        data=json.dumps(rows[:_MAX_ROWS], ensure_ascii=False, default=str),
    )
    try:
        raw = await chat_json(EXPLAIN_PROMPT, user, localize=True)
    except AIGenerationError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise AIGenerationError("İzah alınmadı.", detail=str(exc)[:200]) from exc
    return {"drivers": raw.get("drivers", []), "summary": raw.get("summary", "")}
