"""A/B experiment significance + CRUD."""
from __future__ import annotations

from httpx import AsyncClient

from app.models.experiment import Experiment
from app.services import ab_service


def _exp(kind, data, a="A", b="B"):
    return Experiment(user_id="u", name="t", kind=kind, a_label=a, b_label=b, data=data)


def test_conversion_significant_winner():
    exp = _exp("conversion", {"a": {"n": 1000, "conversions": 100}, "b": {"n": 1000, "conversions": 160}})
    r = ab_service.compute(exp)
    assert r["significant"] and r["winner"] == "B"
    assert r["lift_pct"] > 50 and r["metric"]["b"] == 16.0


def test_conversion_not_significant_tiny_sample():
    exp = _exp("conversion", {"a": {"n": 20, "conversions": 4}, "b": {"n": 20, "conversions": 6}})
    r = ab_service.compute(exp)
    assert not r["significant"] and r["winner"] is None


def test_mean_significant():
    exp = _exp("mean", {"a": {"n": 100, "mean": 50, "sd": 10}, "b": {"n": 100, "mean": 56, "sd": 10}})
    r = ab_service.compute(exp)
    assert r["significant"] and r["winner"] == "B" and r["diff"] == 6.0


def test_conversion_rejects_impossible_counts():
    import pytest

    from app.core.exceptions import NexusBIException

    exp = _exp("conversion", {"a": {"n": 10, "conversions": 50}, "b": {"n": 10, "conversions": 1}})
    with pytest.raises(NexusBIException):
        ab_service.compute(exp)


def test_conversion_rejects_negative_count():
    import pytest

    from app.core.exceptions import NexusBIException

    exp = _exp("conversion", {"a": {"n": -5, "conversions": 0}, "b": {"n": 10, "conversions": 2}})
    with pytest.raises(NexusBIException, match="mənfi"):
        ab_service.compute(exp)


# ─── Endpoint ───

async def test_experiment_crud_and_analyze(client: AsyncClient, auth: dict):
    created = await client.post(
        "/api/v1/experiments/",
        json={
            "name": "Düymə rəngi",
            "kind": "conversion",
            "data": {"a": {"n": 2000, "conversions": 180}, "b": {"n": 2000, "conversions": 260}},
        },
        headers=auth,
    )
    assert created.status_code == 201, created.text
    eid = created.json()["id"]
    assert created.json()["status"] == "draft"

    analyzed = await client.post(f"/api/v1/experiments/{eid}/analyze", headers=auth)
    assert analyzed.status_code == 200, analyzed.text
    body = analyzed.json()
    assert body["status"] == "analyzed" and body["result"]["significant"] is True
    assert body["result"]["winner"] == "B"

    lst = await client.get("/api/v1/experiments/", headers=auth)
    assert len(lst.json()) == 1

    assert (await client.delete(f"/api/v1/experiments/{eid}", headers=auth)).status_code == 204
    assert len((await client.get("/api/v1/experiments/", headers=auth)).json()) == 0


async def test_experiments_require_auth(client: AsyncClient):
    assert (await client.get("/api/v1/experiments/")).status_code == 401
