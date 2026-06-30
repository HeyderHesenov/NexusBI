"""Small helpers for reading numeric data out of a query result's row dicts —
shared by the statistical guard and the causal driver analysis so neither
re-implements column extraction / row alignment.
"""
from __future__ import annotations


def is_num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def numeric_columns(columns: list[str], rows: list[dict]) -> dict[str, list[float]]:
    """Columns that are mostly real numbers → list of their float values (row order)."""
    out: dict[str, list[float]] = {}
    for col in columns:
        vals = [float(r[col]) for r in rows if is_num(r.get(col))]
        if len(vals) >= max(3, len(rows) // 2):
            out[col] = vals
    return out


def aligned_pair(rows: list[dict], col_a: str, col_b: str) -> tuple[list[float], list[float]]:
    """Row-aligned (x, y) over rows where BOTH columns are numeric — so correlations
    use matching observations, not positionally-misaligned per-column survivors."""
    xs: list[float] = []
    ys: list[float] = []
    for r in rows:
        a, b = r.get(col_a), r.get(col_b)
        if is_num(a) and is_num(b):
            xs.append(float(a))
            ys.append(float(b))
    return xs, ys
