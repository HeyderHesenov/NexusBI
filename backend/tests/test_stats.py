"""Statistical primitives + the significance (statistical-guard) endpoint."""
from __future__ import annotations

from httpx import AsyncClient

from app.services import stats


def test_welch_ttest_separates_clear_difference():
    a = [10, 11, 9, 10, 12, 8, 11, 10, 9, 11]
    b = [20, 21, 19, 22, 18, 20, 21, 19, 20, 22]
    res = stats.welch_ttest(a, b)
    assert res.significant and res.p_value < 0.01
    assert abs(res.effect_size) > 3  # huge separation → large Cohen's d


def test_welch_ttest_identical_groups_not_significant():
    a = [5, 5, 5, 5]
    res = stats.welch_ttest(a, list(a))
    assert not res.significant and res.p_value == 1.0


def test_two_proportion_ztest_detects_lift():
    res = stats.two_proportion_ztest(100, 1000, 160, 1000)  # 10% vs 16%
    assert res["significant"] and res["p_value"] < 0.01
    assert res["lift"] > 0.5  # ~60% relative lift
    assert res["ci_low"] > 0  # CI excludes zero


def test_two_proportion_ztest_tiny_sample_not_significant():
    res = stats.two_proportion_ztest(1, 5, 2, 5)
    assert not res["significant"]


def test_pearson_perfect_correlation():
    x = list(range(20))
    y = [2 * v + 1 for v in x]
    res = stats.pearson(x, y)
    assert res["r"] > 0.99 and res["significant"]


def test_pearson_zero_variance_safe():
    res = stats.pearson([1, 1, 1, 1], [1, 2, 3, 4])
    assert res["r"] == 0.0 and not res["significant"]


def test_bh_fdr_controls_discoveries():
    # one tiny p, rest large → only the tiny one survives BH at q=0.05
    flags = stats.bh_fdr([0.001, 0.4, 0.5, 0.6, 0.9])
    assert flags[0] is True and not any(flags[1:])


def test_sample_adequacy_thresholds():
    assert stats.sample_adequacy(2)[0] is False
    assert stats.sample_adequacy(10)[0] is False  # < MIN_SAMPLE
    assert stats.sample_adequacy(50)[0] is True


def test_zscore_outliers_flags_spike():
    vals = [10, 11, 9, 10, 12, 10, 11, 9, 100]
    assert 8 in stats.zscore_outliers(vals)


def test_zscore_outliers_small_sample_not_masked():
    # n=6: a classic mean/std z-score caps at ~2.04 and would MISS this spike; the
    # MAD-based modified z-score still catches it.
    assert 5 in stats.zscore_outliers([10, 10, 11, 9, 10, 500])


# ─── Endpoint ───

async def _make_query(client: AsyncClient, auth: dict) -> str:
    resp = await client.post(
        "/api/v1/query/ask",
        json={"nl_query": "hər məhsul üzrə ümumi gəlir", "datasource_id": None},
        headers=auth,
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["query_log_id"]


async def test_significance_endpoint_returns_checks(client: AsyncClient, auth: dict):
    qid = await _make_query(client, auth)
    resp = await client.post(f"/api/v1/query/{qid}/significance", headers=auth)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert isinstance(body["checks"], list) and len(body["checks"]) >= 1
    assert all({"name", "passed", "severity", "detail"} <= set(c) for c in body["checks"])
    assert "yoxlama" in body["summary"]


async def test_significance_requires_auth(client: AsyncClient):
    resp = await client.post("/api/v1/query/whatever/significance")
    assert resp.status_code == 401
