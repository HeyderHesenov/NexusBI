"""Statistical guard — turns a query result into a list of trust checks so the UI
can warn when an apparent pattern isn't statistically supported (tiny sample,
flat data, a 'top' value that isn't really different, spurious correlations).

Deterministic (numpy/scipy via app.services.stats), no AI. Best-effort: any check
that can't run is simply skipped.
"""
from __future__ import annotations

import numpy as np

from app.ai import analysis
from app.core.exceptions import AIGenerationError
from app.services import stats
from app.services.tabular import aligned_pair, numeric_columns


def build_report(columns: list[str], rows: list[dict]) -> dict:
    """Return {checks: [{name, passed, severity, detail}], summary}."""
    checks: list[dict] = []
    n = len(rows)

    ok, msg = stats.sample_adequacy(n)
    checks.append({"name": "Nümunə həcmi", "passed": ok,
                   "severity": "warn" if not ok else "ok", "detail": msg})

    numerics = numeric_columns(columns, rows)

    # Spread check: if the metric is nearly flat (low coefficient of variation), the
    # segment ranking is essentially noise. This is descriptive — NOT a select-then-test
    # of "top vs rest" (which is circular: sorting then t-testing always finds a gap).
    try:
        _label, value_col = analysis.pick_series(columns, rows)
        series = numerics.get(value_col, [])
        if len(series) >= 3:
            arr = np.asarray(series, dtype=float)
            mean = float(arr.mean())
            cv = float(arr.std() / abs(mean)) if mean != 0 else 0.0
            meaningful = cv >= 0.1  # < 10% relative spread → segments barely differ
            checks.append({
                "name": "Dəyər yayılması",
                "passed": meaningful,
                "severity": "ok" if meaningful else "warn",
                "detail": (
                    f"Nisbi yayılma {cv * 100:.0f}% — fərqlər mənalıdır."
                    if meaningful
                    else f"Nisbi yayılma cəmi {cv * 100:.0f}% — seqmentlər demək olar eyni, sıralama az əhəmiyyətli."
                ),
            })
    except AIGenerationError:
        pass

    # Spurious-correlation flag: numeric pairs that correlate strongly but on too
    # little data (computed on ROW-ALIGNED pairs, not per-column survivors).
    cols = list(numerics)
    flagged = 0
    for i in range(len(cols)):
        for j in range(i + 1, len(cols)):
            xs, ys = aligned_pair(rows, cols[i], cols[j])
            pr = stats.pearson(xs, ys)
            if abs(pr["r"]) >= 0.7 and (pr["n"] < stats.MIN_SAMPLE or not pr["significant"]):
                flagged += 1
    if cols and len(cols) >= 2:
        checks.append({
            "name": "Saxta korrelyasiya",
            "passed": flagged == 0,
            "severity": "warn" if flagged else "ok",
            "detail": (
                f"{flagged} güclü amma statistik dəstəklənməyən korrelyasiya."
                if flagged else "Şübhəli korrelyasiya yoxdur."
            ),
        })

    passed = sum(1 for c in checks if c["passed"])
    summary = f"{passed}/{len(checks)} yoxlama keçdi."
    return {"checks": checks, "summary": summary}
