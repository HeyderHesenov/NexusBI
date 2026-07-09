"""Deterministic, computed facts from a query result — the grounding behind the
narrative insight (total, top contributor, period delta, anomalies). The headline
numbers are math, not LLM prose. Pure functions: no AI, no DB.
"""
from __future__ import annotations

import math
import re
from typing import Any

from app.services import stats

# YYYY-MM / YYYY/MM prefixes. Mirrored in frontend/src/lib/kpi.ts (KPI card
# delta derivation) — keep the regex and the majority threshold in sync.
_TEMPORAL = re.compile(r"^\d{4}[-/]\d{2}")
_SAMPLE_N = 20  # rows scanned to classify a column as numeric


def _looks_temporal(labels: list[str]) -> bool:
    """True when most labels look like dated periods → a period delta is meaningful."""
    if len(labels) < 2:
        return False
    hits = sum(1 for s in labels if _TEMPORAL.match(s))
    return hits >= max(2, len(labels) // 2)


def _numeric_columns(columns: list[str], rows: list[dict[str, Any]]) -> list[str]:
    """Columns where the (non-null) sampled values are ≥80% finite-numeric. Scans
    several rows (not just row[0], which may be NULL) and accepts numeric strings
    like "1,234" — consistent with how the anomaly/forecast panels coerce values."""
    out = []
    for c in columns:
        seen = coerced = 0
        for r in rows[:_SAMPLE_N]:
            v = r.get(c)
            if v is None or (isinstance(v, float) and not math.isfinite(v)):
                continue  # null / nan / inf = missing data, not evidence against numeric
            seen += 1
            if stats.to_float(v) is not None:
                coerced += 1
        if seen and coerced >= seen * 0.8:
            out.append(c)
    return out


def compute_facts(columns: list[str], rows: list[dict[str, Any]]) -> list[dict[str, str]]:
    """Up to ~4 compact fact chips ``{kind, label, value}`` over the measure column.
    Empty when there is no numeric column or no finite values."""
    if not rows or not columns:
        return []
    numeric = _numeric_columns(columns, rows)
    if not numeric:
        return []
    # The measure is typically the LAST numeric column in a BI SELECT
    # (`SELECT dimension, SUM(x)`), so a dimension like year/id isn't mistaken for it.
    value_col = numeric[-1]
    label_col = next((c for c in columns if c != value_col), None)

    finite = [(i, v) for i, r in enumerate(rows) if (v := stats.to_float(r.get(value_col))) is not None]
    if not finite:
        return []
    vals = [v for _, v in finite]
    total = sum(vals)

    # `label` carries only data-derived text (the top category name); the descriptor
    # for total/trend/anomaly is localized on the frontend from `kind`.
    facts: list[dict[str, str]] = [
        {"kind": "total", "label": "", "value": stats.compact_number(total)}
    ]

    # Top contributor + its share of the total (share is only meaningful for a
    # positive total — a negative total flips the sign into nonsense).
    if label_col and total > 0:
        best_i, best_v = max(finite, key=lambda t: t[1])
        pct = best_v / total * 100
        facts.append({
            "kind": "top",
            "label": str(rows[best_i].get(label_col)),
            "value": f"{stats.compact_number(best_v)} ({pct:.0f}%)",
        })

    # Period-over-period change for a dated series (first → last).
    if label_col and len(vals) >= 2 and vals[0]:
        labels = [str(rows[i].get(label_col)) for i, _ in finite]
        if _looks_temporal(labels):
            delta = (vals[-1] - vals[0]) / abs(vals[0]) * 100
            facts.append({"kind": "trend", "label": "", "value": f"{delta:+.0f}%"})

    # Robust anomaly count (same MAD z-score the anomaly panel uses).
    outliers = stats.zscore_outliers(vals)
    if outliers:
        facts.append({"kind": "anomaly", "label": "", "value": str(len(outliers))})

    return facts
