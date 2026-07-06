"""Unit tests for the deterministic forecast + anomaly statistics (no AI, no DB)."""
from __future__ import annotations

import math

import pytest

from app.ai import analysis
from app.services import stats


def test_forecast_linear_trend_extrapolates():
    # y = 10, 20, 30, ... perfect line → next ≈ continuation, tight interval.
    values = [10.0 * i for i in range(1, 13)]  # 10..120
    fc = stats.forecast_series(values, periods=3)
    assert fc["method"] == "trend"
    yhats = [p["yhat"] for p in fc["points"]]
    assert yhats[0] == pytest.approx(130.0)
    assert yhats[2] == pytest.approx(150.0)
    # Perfect line → residual std ~0 → interval collapses around yhat.
    for p in fc["points"]:
        assert p["lower"] <= p["yhat"] <= p["upper"]
        assert (p["upper"] - p["lower"]) < 1.0


def test_forecast_detects_seasonality():
    # Repeating 4-period pattern with a mild upward drift.
    base = [10, 40, 20, 30]
    values = [base[i % 4] + i * 0.5 for i in range(16)]
    fc = stats.forecast_series(values, periods=4)
    assert fc["method"].startswith("trend+seasonal")
    assert "4" in fc["method"]


def test_forecast_small_sample_is_naive():
    fc = stats.forecast_series([5.0, 7.0], periods=3)
    assert fc["method"] == "naive"
    assert len(fc["points"]) == 3
    assert all(p["yhat"] == 7.0 for p in fc["points"])  # repeats last value
    assert all(p["upper"] > p["lower"] for p in fc["points"])  # non-zero band


def test_forecast_empty():
    fc = stats.forecast_series([], periods=3)
    assert fc["method"] == "empty"
    assert fc["points"] == []


def test_forecast_interval_widens_with_horizon():
    values = [i + (i % 3) for i in range(20)]  # trend + noise
    fc = stats.forecast_series(values, periods=6)
    widths = [p["upper"] - p["lower"] for p in fc["points"]]
    assert widths[-1] > widths[0]  # further out → wider band


def test_modified_zscores_flags_planted_outlier():
    series = [10.0, 11.0, 9.0, 10.5, 100.0, 10.2, 9.8]
    flagged = stats.zscore_outliers(series)
    assert 4 in flagged  # the 100.0 spike
    mz = stats.modified_zscores(series)
    assert mz[4] == max(mz)


def test_modified_zscores_constant_series_no_outliers():
    assert stats.zscore_outliers([5.0, 5.0, 5.0, 5.0, 5.0]) == []
    assert stats.modified_zscores([5.0, 5.0, 5.0]) == [0.0, 0.0, 0.0]


async def test_detect_anomalies_flags_spike():
    columns = ["month", "revenue"]
    rows = [{"month": f"2026-{m:02d}", "revenue": v}
            for m, v in enumerate([100, 105, 98, 102, 500, 101, 99], start=1)]
    out = await analysis.detect_anomalies(columns, rows, "aylıq gəlir")
    assert out["value_col"] == "revenue"
    labels = [a["label"] for a in out["anomalies"]]
    assert "2026-05" in labels  # the 500 spike
    assert out["anomalies"][0]["severity"] in {"high", "medium", "low"}


async def test_detect_anomalies_ignores_nan_and_inf():
    # A NaN must not poison the median and disable detection; inf must not leak
    # a non-JSON value. The real 500 spike must still be flagged.
    columns = ["month", "revenue"]
    raw = [100, 105, float("nan"), 102, 500, float("inf"), 99, 101]
    rows = [{"month": f"2026-{m:02d}", "revenue": v} for m, v in enumerate(raw, start=1)]
    out = await analysis.detect_anomalies(columns, rows, "aylıq gəlir")
    labels = [a["label"] for a in out["anomalies"]]
    assert "2026-05" in labels  # the 500 spike survives despite nan/inf in the series
    for a in out["anomalies"]:
        assert math.isfinite(a["value"])  # no inf/nan leaked into the response


async def test_forecast_async_shape_and_labels():
    columns = ["month", "revenue"]
    rows = [{"month": f"2026-{m:02d}", "revenue": 100 + 10 * m} for m in range(1, 7)]
    out = await analysis.forecast(columns, rows, "aylıq gəlir", periods=3)
    assert out["value_col"] == "revenue"
    assert out["method"]
    assert [p["label"] for p in out["forecast"]] == ["2026-07", "2026-08", "2026-09"]
    for p in out["forecast"]:
        assert p["lower"] <= p["value"] <= p["upper"]
    assert out["narrative"]
