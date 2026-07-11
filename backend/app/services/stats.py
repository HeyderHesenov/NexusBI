"""Statistical primitives — the trust layer shared by the causal and
insight-engine features. Pure functions (scipy + numpy), no AI, no DB.

Every function is defensive: degenerate input (too few points, zero variance)
returns a non-significant result rather than raising, so callers can always
surface an honest "not enough evidence" instead of a crash.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy import stats as _sp

MIN_SAMPLE = 20  # below this, a result is "directional, not conclusive"


def to_float(v: object) -> float | None:
    """Coerce to a FINITE float, else None. Rejecting nan/inf here is the single
    guard that keeps them out of every downstream series (a lone NaN would poison a
    median; an inf would leak a non-JSON value). Shared by forecast/anomaly/insight."""
    if isinstance(v, bool):
        return None
    try:
        f = float(v) if isinstance(v, (int, float)) else float(str(v).replace(",", ""))
    except (TypeError, ValueError):
        return None
    return f if np.isfinite(f) else None


def compact_number(v: float) -> str:
    """Compact human number (5.5K / 1.2M) for narratives and stat chips — no locale
    dependency. Non-finite → '—'."""
    if not np.isfinite(v):
        return "—"
    a = abs(v)
    if a >= 1_000_000:
        return f"{v / 1_000_000:.1f}M"
    if a >= 1_000:
        return f"{v / 1_000:.1f}K"
    if a == int(a):
        return str(int(v))
    return f"{v:.2f}"


@dataclass(frozen=True)
class TestResult:
    statistic: float
    p_value: float
    significant: bool
    detail: str
    effect_size: float = 0.0  # Cohen's d (mean difference in pooled-SD units)


def significance_label(p: float) -> str:
    if p < 0.01:
        return "yüksək əhəmiyyətli"
    if p < 0.05:
        return "əhəmiyyətli"
    if p < 0.1:
        return "zəif əhəmiyyətli"
    return "əhəmiyyətsiz"


def sample_adequacy(n: int, min_n: int = MIN_SAMPLE) -> tuple[bool, str]:
    if n < 3:
        return False, f"Yalnız {n} müşahidə — statistik nəticə çıxarmaq olmaz."
    if n < min_n:
        return False, f"{n} müşahidə (< {min_n}) — istiqamət göstərir, qəti deyil."
    return True, f"{n} müşahidə — kifayətdir."


def welch_ttest(a: list[float], b: list[float], alpha: float = 0.05) -> TestResult:
    """Two-sample Welch t-test (unequal variance) of mean(a) vs mean(b)."""
    a_arr, b_arr = np.asarray(a, dtype=float), np.asarray(b, dtype=float)
    if a_arr.size < 2 or b_arr.size < 2:
        return TestResult(0.0, 1.0, False, "Hər qrupda ən az 2 müşahidə lazımdır.")
    if np.var(a_arr) == 0 and np.var(b_arr) == 0:
        return TestResult(0.0, 1.0, False, "Hər iki qrupda varians sıfırdır.")
    t, p = _sp.ttest_ind(a_arr, b_arr, equal_var=False)
    # Cohen's d (pooled SD) — effect size, so callers don't treat a tiny but
    # "significant" difference at large n as meaningful.
    na, nb = a_arr.size, b_arr.size
    pooled_sd = (((na - 1) * np.var(a_arr, ddof=1) + (nb - 1) * np.var(b_arr, ddof=1)) / (na + nb - 2)) ** 0.5
    d = float((a_arr.mean() - b_arr.mean()) / pooled_sd) if pooled_sd > 0 else 0.0
    return TestResult(float(t), float(p), bool(p < alpha), significance_label(float(p)), d)


def pearson(x: list[float], y: list[float]) -> dict:
    """Pearson correlation r + p-value. Guards short / zero-variance input."""
    x_arr, y_arr = np.asarray(x, dtype=float), np.asarray(y, dtype=float)
    n = int(min(x_arr.size, y_arr.size))
    if n < 3 or np.var(x_arr[:n]) == 0 or np.var(y_arr[:n]) == 0:
        return {"r": 0.0, "p_value": 1.0, "n": n, "significant": False}
    r, p = _sp.pearsonr(x_arr[:n], y_arr[:n])
    return {"r": float(r), "p_value": float(p), "n": n, "significant": bool(p < 0.05)}


def bh_fdr(p_values: list[float], q: float = 0.05) -> list[bool]:
    """Benjamini-Hochberg: which p-values survive at false-discovery rate q.
    Controls false positives when testing many drivers at once."""
    if not p_values:
        return []
    adjusted = _sp.false_discovery_control(np.asarray(p_values, dtype=float), method="bh")
    return [bool(a < q) for a in adjusted]


def modified_zscores(values: list[float]) -> list[float]:
    """Per-point MAD-based modified z-score (robust). Falls back to a mean/std
    z-score when >half the values are identical (MAD=0). Empty for empty input.
    Shared by `zscore_outliers` (flagging) and the anomaly detail (severity),
    so the two can never disagree on the same series."""
    arr = np.asarray(values, dtype=float)
    if arr.size == 0:
        return []
    median = float(np.median(arr))
    mad = float(np.median(np.abs(arr - median)))
    if mad > 0:
        return (0.6745 * np.abs(arr - median) / mad).tolist()
    sd = float(arr.std())
    if sd == 0:
        return [0.0] * int(arr.size)
    return (np.abs(arr - arr.mean()) / sd).tolist()


def _autocorr(y: np.ndarray, lag: int) -> float:
    """Lag-`lag` autocorrelation of a mean-centred series (0 if degenerate)."""
    yc = y - y.mean()
    denom = float(np.sum(yc * yc))
    if denom == 0 or lag >= yc.size:
        return 0.0
    return float(np.sum(yc[lag:] * yc[:-lag]) / denom)


def _detect_period(residual: np.ndarray, candidates: tuple[int, ...] = (12, 7, 4)) -> int | None:
    """Pick a seasonal period whose autocorrelation on the detrended series is
    strong (>0.3) and needs ≥2 full cycles of data. None → no seasonality."""
    n = residual.size
    best, best_ac = None, 0.3
    for m in candidates:
        if n >= 2 * m:
            ac = _autocorr(residual, m)
            if ac > best_ac:
                best, best_ac = m, ac
    return best


# 80% two-sided prediction interval (matches the "80% band" the UI renders).
_Z80 = 1.2815515594457831


def forecast_series(values: list[float], periods: int, z: float = _Z80) -> dict:
    """Deterministic statistical forecast — linear trend + optional additive
    seasonality (classical decomposition), with residual-based prediction
    intervals. No AI, reproducible. Returns
    ``{"points": [{"yhat","lower","upper"}], "method", "resid_std"}``.

    Small samples degrade gracefully: n<3 → naive (last value) with a spread-based
    band. The interval widens with horizon (√(1+h/n)) to reflect extrapolation risk.
    """
    y = np.asarray([v for v in values if v is not None], dtype=float)
    y = y[np.isfinite(y)]
    n = int(y.size)
    if n == 0:
        return {"points": [], "method": "empty", "resid_std": 0.0, "z": z}
    if n < 3:
        last = float(y[-1])
        spread = float(np.std(y)) if n > 1 else abs(last) * 0.1
        if spread == 0:
            spread = abs(last) * 0.1 + 1.0
        band = z * spread
        pts = [{"yhat": last, "lower": last - band, "upper": last + band} for _ in range(periods)]
        return {"points": pts, "method": "naive", "resid_std": float(spread), "z": z}

    x = np.arange(n, dtype=float)
    slope, intercept = np.polyfit(x, y, 1)
    trend = intercept + slope * x
    m = _detect_period(y - trend)
    seasonal_idx = None
    method = "trend"
    if m:
        detr = y - trend
        seasonal_idx = np.array([detr[j::m].mean() for j in range(m)], dtype=float)
        seasonal_idx = seasonal_idx - seasonal_idx.mean()
        fitted = trend + seasonal_idx[(x % m).astype(int)]
        method = f"trend+seasonal{m}"
    else:
        fitted = trend

    resid = y - fitted
    resid_std = float(np.std(resid, ddof=1)) if n > 2 else float(np.std(resid))
    if resid_std == 0:
        resid_std = abs(float(y.mean())) * 0.02 + 1e-9  # avoid a zero-width band

    pts = []
    for h in range(1, periods + 1):
        t = n - 1 + h
        yhat = float(intercept + slope * t)
        if seasonal_idx is not None:
            yhat += float(seasonal_idx[t % m])
        band = z * resid_std * (1.0 + h / n) ** 0.5
        pts.append({"yhat": yhat, "lower": yhat - band, "upper": yhat + band})
    return {"points": pts, "method": method, "resid_std": resid_std, "z": z}


def zscore_outliers(values: list[float], threshold: float = 3.5) -> list[int]:
    """Indices flagged as outliers by the MAD-based MODIFIED z-score (delegates to
    `modified_zscores`, so flagging and severity can't drift). Robust to the masking
    effect (a classic mean/std z-score caps at (n-1)/sqrt(n), so it can't flag a lone
    outlier when n<=8 — the modified z-score has no such ceiling). Empty if the sample
    is too small (<4) or has no spread."""
    if len(values) < 4:
        return []
    return [i for i, mz in enumerate(modified_zscores(values)) if mz > threshold]
