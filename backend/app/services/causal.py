"""Causal / driver analysis — ranks which OTHER numeric columns most strongly
associate with a target metric (Pearson r, p-value, BH-FDR), with honest caveats.

Distinct from `ai/root_cause` (single-series magnitude-share decomposition tree):
this is statistical, deterministic (no AI), and reports correlation strength +
significance, not size. Correlation ≠ causation — surfaced in caveats.
"""
from __future__ import annotations

import numpy as np

from app.ai import analysis
from app.core.exceptions import AIGenerationError
from app.services import stats
from app.services.tabular import aligned_pair, numeric_columns

MIN_PAIR = 5  # below this many aligned points a correlation can't be tested


def _strength(r: float) -> str:
    a = abs(r)
    if a >= 0.7:
        return "güclü"
    if a >= 0.4:
        return "orta"
    return "zəif"


def analyze(columns: list[str], rows: list[dict]) -> dict:
    """Return {target, drivers:[{feature,r,p_value,significant,direction,strength}],
    summary, caveats}."""
    caveats: list[str] = []
    # Use ONE numeric-column definition for both target and features (pick_series and
    # numeric_columns use different rules — unifying avoids a target/feature mismatch).
    numerics = numeric_columns(columns, rows)
    if not numerics:
        return {"target": "", "drivers": [], "summary": "Ədədi hədəf sütunu tapılmadı.",
                "caveats": ["Korrelyasiya üçün ən az bir ədədi sütun lazımdır."]}
    try:
        _label, preferred = analysis.pick_series(columns, rows)
    except AIGenerationError:
        preferred = None
    target = preferred if preferred in numerics else next(iter(numerics))

    features = [c for c in numerics if c != target]
    if not features:
        return {"target": target, "drivers": [], "caveats": caveats,
                "summary": "Bu nəticədə hədəfdən başqa ədədi dəyişən yoxdur — "
                           "səbəb analizi üçün çox-ölçülü sorğu lazımdır."}

    raw: list[dict] = []
    dropped: list[str] = []
    for f in features:
        xs, ys = aligned_pair(rows, target, f)
        if len(xs) < MIN_PAIR:
            continue  # too few aligned points to test — don't dilute the BH family
        if np.allclose(xs, ys):
            dropped.append(f)  # same values as the target — a tautology, not a driver
            continue
        pr = stats.pearson(xs, ys)
        raw.append({"feature": f, "r": pr["r"], "p_value": pr["p_value"], "n": pr["n"]})

    if dropped:
        caveats.append(f"Hədəflə eyni olan sütun(lar) çıxarıldı: {', '.join(dropped)}.")
    if not raw:
        return {"target": target, "drivers": [], "caveats": caveats,
                "summary": "Test edilə bilən müstəqil driver tapılmadı (kifayət qədər uyğun nöqtə yox)."}

    raw.sort(key=lambda d: abs(d["r"]), reverse=True)  # sort on full-precision r
    # Multiple-comparison control: testing many features inflates false positives.
    # BH booleans align with the (now sorted) list order.
    survives = stats.bh_fdr([d["p_value"] for d in raw])
    drivers = [{
        "feature": d["feature"],
        "r": round(d["r"], 3),
        "p_value": round(d["p_value"], 4),
        "significant": bool(sig),
        "direction": "müsbət" if d["r"] >= 0 else "mənfi",
        "strength": _strength(d["r"]),
    } for d, sig in zip(raw, survives, strict=True)]

    n = min((d["n"] for d in raw), default=0)
    if n < stats.MIN_SAMPLE:
        caveats.append(f"Ən az uyğun müşahidə {n} — nəticələr istiqamətlidir, qəti deyil.")
    caveats.append("Korrelyasiya səbəbiyyət demək deyil — gizli amillər ola bilər.")

    top = next((d for d in drivers if d["significant"]), None)
    if top:
        summary = (f"Ən güclü əlaqə: {top['feature']} ({top['direction']}, r={top['r']}, "
                   f"{_strength(top['r'])}, p={top['p_value']}).")
    else:
        summary = "Statistik əhəmiyyətli driver tapılmadı (çoxlu-müqayisə düzəlişindən sonra)."
    return {"target": target, "drivers": drivers, "summary": summary, "caveats": caveats}
