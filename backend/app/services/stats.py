"""Statistical primitives — the trust layer shared by the causal, A/B, and
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


def welch_ttest_from_stats(
    mean1: float, sd1: float, n1: int, mean2: float, sd2: float, n2: int, alpha: float = 0.05
) -> dict:
    """Welch t-test from summary stats (mean/sd/n per group) — for A/B on a continuous
    metric where only aggregates are stored. Returns diff, 95% CI, verdict."""
    if n1 < 2 or n2 < 2:
        return {"t": 0.0, "p_value": 1.0, "significant": False, "diff": mean2 - mean1,
                "ci_low": 0.0, "ci_high": 0.0, "detail": "Hər qrupda ən az 2 müşahidə lazımdır."}
    se = (sd1**2 / n1 + sd2**2 / n2) ** 0.5
    if se == 0:
        return {"t": 0.0, "p_value": 1.0, "significant": False, "diff": mean2 - mean1,
                "ci_low": mean2 - mean1, "ci_high": mean2 - mean1, "detail": "Varians sıfırdır."}
    t, p = _sp.ttest_ind_from_stats(mean1, sd1, n1, mean2, sd2, n2, equal_var=False)
    # Welch–Satterthwaite df for the CI.
    df = se**4 / ((sd1**2 / n1) ** 2 / (n1 - 1) + (sd2**2 / n2) ** 2 / (n2 - 1))
    crit = float(_sp.t.ppf(0.975, df))
    diff = mean2 - mean1
    return {"t": float(t), "p_value": float(p), "significant": bool(p < alpha), "diff": float(diff),
            "ci_low": float(diff - crit * se), "ci_high": float(diff + crit * se),
            "detail": significance_label(float(p))}


def two_proportion_ztest(
    c1: int, n1: int, c2: int, n2: int, alpha: float = 0.05
) -> dict:
    """Two-sample proportion z-test (conversion A vs B) with lift + 95% CI of the
    difference. Returns p1/p2/lift/ci and a significance verdict."""
    if n1 <= 0 or n2 <= 0:
        return {"z": 0.0, "p_value": 1.0, "significant": False, "p1": 0.0, "p2": 0.0,
                "lift": 0.0, "ci_low": 0.0, "ci_high": 0.0, "detail": "Boş qrup."}
    p1, p2 = c1 / n1, c2 / n2
    pooled = (c1 + c2) / (n1 + n2)
    se = (pooled * (1 - pooled) * (1 / n1 + 1 / n2)) ** 0.5
    z = (p2 - p1) / se if se > 0 else 0.0
    p_value = float(2 * _sp.norm.sf(abs(z)))
    # CI of the difference uses the unpooled SE.
    se_diff = (p1 * (1 - p1) / n1 + p2 * (1 - p2) / n2) ** 0.5
    half = 1.959963984540054 * se_diff  # z_{0.975}
    lift = (p2 - p1) / p1 if p1 > 0 else 0.0
    return {
        "z": float(z), "p_value": p_value, "significant": bool(p_value < alpha),
        "p1": float(p1), "p2": float(p2), "lift": float(lift),
        "ci_low": float((p2 - p1) - half), "ci_high": float((p2 - p1) + half),
        "detail": significance_label(p_value),
    }


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


def zscore_outliers(values: list[float], threshold: float = 3.5) -> list[int]:
    """Indices flagged as outliers by the MAD-based MODIFIED z-score. Robust to
    the masking effect (a classic mean/std z-score caps at (n-1)/sqrt(n), so it
    can't flag a lone outlier when n<=8 — the modified z-score has no such ceiling).
    Empty if the sample is too small or has no spread."""
    arr = np.asarray(values, dtype=float)
    if arr.size < 4:
        return []
    median = np.median(arr)
    mad = np.median(np.abs(arr - median))
    if mad > 0:
        mz = 0.6745 * np.abs(arr - median) / mad
        return [int(i) for i in np.where(mz > threshold)[0]]
    # >half the values are identical → fall back to std-based if any spread remains.
    sd = arr.std()
    if sd == 0:
        return []
    z = np.abs((arr - arr.mean()) / sd)
    return [int(i) for i in np.where(z > threshold)[0]]
