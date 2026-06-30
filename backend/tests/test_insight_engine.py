"""Insight engine — candidate discovery + ranking + endpoints."""
from __future__ import annotations

from httpx import AsyncClient

from app.services import insight_engine


def _rows(pairs):
    return ["seqment", "deyer"], [{"seqment": s, "deyer": v} for s, v in pairs]


def test_dominance_detected():
    cols, rows = _rows([("A", 800), ("B", 100), ("C", 50), ("D", 50)])
    cands = insight_engine._candidates("satış", cols, rows, None)
    kinds = {c["kind"] for c in cands}
    assert "dominance" in kinds
    dom = next(c for c in cands if c["kind"] == "dominance")
    assert "A" in dom["title"] and dom["impact_score"] >= 0.4


def test_concentration_detected():
    cols, rows = _rows([("A", 50), ("B", 40), ("C", 35), ("D", 3), ("E", 2), ("F", 1)])
    cands = insight_engine._candidates("satış", cols, rows, None)
    assert any(c["kind"] == "concentration" for c in cands)


def test_outlier_detected():
    cols, rows = _rows([("a", 10), ("b", 11), ("c", 9), ("d", 10), ("e", 12), ("f", 900)])
    cands = insight_engine._candidates("satış", cols, rows, None)
    outliers = [c for c in cands if c["kind"] == "outlier"]
    assert outliers and "f" in outliers[0]["title"]


def test_flat_data_no_insights():
    cols, rows = _rows([("a", 10), ("b", 10), ("c", 10), ("d", 10)])
    cands = insight_engine._candidates("satış", cols, rows, None)
    # near-uniform → no dominance/concentration/outlier
    assert cands == []


# ─── Endpoints ───

async def test_insights_generate_list_dismiss(client: AsyncClient, auth: dict):
    await client.post(
        "/api/v1/query/ask",
        json={"nl_query": "hər məhsul üzrə ümumi gəlir", "datasource_id": None},
        headers=auth,
    )
    gen = await client.post("/api/v1/insights/generate", headers=auth)
    assert gen.status_code == 200 and isinstance(gen.json()["created"], int)

    lst = await client.get("/api/v1/insights/", headers=auth)
    assert lst.status_code == 200 and isinstance(lst.json(), list)
    for ins in lst.json():
        assert {"id", "kind", "title", "impact_score", "dismissed"} <= set(ins)

    # idempotent: a second generate creates no duplicates (same dedup keys)
    gen2 = await client.post("/api/v1/insights/generate", headers=auth)
    assert gen2.json()["created"] == 0


async def test_insights_require_auth(client: AsyncClient):
    assert (await client.get("/api/v1/insights/")).status_code == 401
