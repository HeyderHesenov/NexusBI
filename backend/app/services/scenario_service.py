"""Scenario planning math: goal-seek, Monte Carlo, KPI pacing. No AI — pure,
fast, deterministic (Monte Carlo accepts a seed for reproducibility)."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import numpy as np

_PERIOD_DAYS = {"month": 30, "quarter": 91, "year": 365}


def goal_seek(values: list[float], target: float) -> dict[str, Any]:
    """From the latest value, what change reaches ``target``?"""
    clean = [float(v) for v in values if isinstance(v, (int, float))]
    current = clean[-1] if clean else 0.0
    total = sum(clean)
    required_pct = ((target / current - 1) * 100) if current else None
    return {
        "current": round(current, 4),
        "total": round(total, 4),
        "target": round(target, 4),
        "gap": round(target - current, 4),
        "required_pct": round(required_pct, 2) if required_pct is not None else None,
    }


def monte_carlo(
    values: list[float], periods: int = 6, runs: int = 1000, seed: int | None = None
) -> dict[str, Any]:
    """Simulate future paths from historical period-over-period returns.

    Returns per-period P10/P50/P90 bands plus the starting value.
    """
    clean = [float(v) for v in values if isinstance(v, (int, float))]
    if len(clean) < 2:
        raise ValueError("Monte Carlo üçün ən azı 2 nöqtə lazımdır.")
    arr = np.array(clean, dtype=float)
    # Period-over-period returns; guard against zero denominators.
    prev = arr[:-1]
    rets = np.divide(arr[1:] - prev, prev, out=np.zeros_like(prev), where=prev != 0)
    mu, sigma = float(np.mean(rets)), float(np.std(rets)) or 0.01
    periods = max(1, min(periods, 36))
    runs = max(100, min(runs, 5000))

    rng = np.random.default_rng(seed)
    start = float(arr[-1])
    # shocks: runs x periods
    shocks = rng.normal(mu, sigma, size=(runs, periods))
    paths = start * np.cumprod(1 + shocks, axis=1)

    p10 = np.percentile(paths, 10, axis=0)
    p50 = np.percentile(paths, 50, axis=0)
    p90 = np.percentile(paths, 90, axis=0)
    bands = [
        {"period": i + 1, "p10": round(float(p10[i]), 2),
         "p50": round(float(p50[i]), 2), "p90": round(float(p90[i]), 2)}
        for i in range(periods)
    ]
    return {"start": round(start, 2), "mean_return_pct": round(mu * 100, 2), "bands": bands}


def _aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def pacing(
    target_value: float,
    current_value: float,
    period: str,
    period_start: datetime | None,
    now: datetime | None = None,
) -> dict[str, Any]:
    """How the current value paces against the target for the period elapsed."""
    now = now or datetime.now(timezone.utc)
    if target_value <= 0:
        # A non-positive target is meaningless to pace against.
        return {
            "attainment_pct": 0.0, "elapsed_pct": 0.0, "expected_value": 0.0,
            "on_track": False, "status": "hədəf təyin edilməyib",
        }
    attainment = current_value / target_value * 100
    days = _PERIOD_DAYS.get(period, 30)
    start = _aware(period_start)
    elapsed = (now - start).total_seconds() / 86400 if start else days / 2
    elapsed_pct = max(0.0, min(100.0, elapsed / days * 100))
    expected_value = target_value * (elapsed_pct / 100)
    on_track = current_value >= expected_value
    return {
        "attainment_pct": round(attainment, 1),
        "elapsed_pct": round(elapsed_pct, 1),
        "expected_value": round(expected_value, 2),
        "on_track": on_track,
        "status": "irəlidə" if on_track else "geridə",
    }
