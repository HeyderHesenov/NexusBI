"""Causal / driver analysis (statistical, deterministic)."""
from __future__ import annotations

from httpx import AsyncClient

from app.services import causal


def _rows(target, a, b):
    cols = ["region", "target", "feat_a", "feat_b"]
    rows = [
        {"region": f"r{i}", "target": target[i], "feat_a": a[i], "feat_b": b[i]}
        for i in range(len(target))
    ]
    return cols, rows


def test_causal_ranks_the_real_driver_first():
    n = 30
    target = list(range(n))
    feat_a = [2 * v + 1 for v in target]          # strong positive driver
    feat_b = [(v * 7) % 5 for v in target]         # noise
    cols, rows = _rows(target, feat_a, feat_b)
    res = causal.analyze(cols, rows)
    assert res["target"] == "target"
    assert res["drivers"][0]["feature"] == "feat_a"
    assert res["drivers"][0]["significant"] and res["drivers"][0]["direction"] == "müsbət"
    assert any("səbəbiyyət" in c for c in res["caveats"])  # correlation≠causation caveat


def test_causal_negative_driver_direction():
    n = 25
    target = list(range(n))
    feat_a = [100 - 3 * v for v in target]  # strong negative
    feat_b = [5 for _ in target]            # constant → no correlation
    cols, rows = _rows(target, feat_a, feat_b)
    res = causal.analyze(cols, rows)
    top = res["drivers"][0]
    assert top["feature"] == "feat_a" and top["direction"] == "mənfi" and top["r"] < 0


def test_causal_single_numeric_column_is_honest():
    cols = ["product", "total"]
    rows = [{"product": f"p{i}", "total": i * 10} for i in range(10)]
    res = causal.analyze(cols, rows)
    assert res["drivers"] == [] and "çox-ölçülü" in res["summary"]


def test_causal_no_numeric_target():
    cols = ["a", "b"]
    rows = [{"a": "x", "b": "y"}]
    res = causal.analyze(cols, rows)
    assert res["drivers"] == [] and res["target"] == ""


def test_causal_drops_identical_column_tautology():
    # A column holding the SAME values as the target is a tautology, not a driver.
    n = 25
    target = [i * 3 + 7 for i in range(n)]
    cols = ["region", "target", "dup", "feat"]
    rows = [
        {"region": f"r{i}", "target": target[i], "dup": target[i], "feat": (i * 11) % 7}
        for i in range(n)
    ]
    res = causal.analyze(cols, rows)
    assert "dup" not in [d["feature"] for d in res["drivers"]]
    assert any("eyni" in c for c in res["caveats"])


# ─── Endpoint ───

async def test_causal_endpoint(client: AsyncClient, auth: dict):
    qid = (
        await client.post(
            "/api/v1/query/ask",
            json={"nl_query": "hər məhsul üzrə ümumi gəlir", "datasource_id": None},
            headers=auth,
        )
    ).json()["query_log_id"]
    resp = await client.post(f"/api/v1/query/{qid}/causal", headers=auth)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert {"target", "drivers", "summary", "caveats"} <= set(body)


async def test_causal_requires_auth(client: AsyncClient):
    assert (await client.post("/api/v1/query/x/causal")).status_code == 401
