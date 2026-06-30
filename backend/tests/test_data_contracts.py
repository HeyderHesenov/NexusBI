"""Data contracts — column checks + end-to-end run over an uploaded source."""
from __future__ import annotations

from httpx import AsyncClient

from app.services import data_contract_service as svc


def _stat(column, null_pct=0.0, distinct=4, sample_size=4, mn=None, mx=None):
    return {"column": column, "null_pct": null_pct, "distinct": distinct,
            "sample_size": sample_size, "min": mn, "max": mx}


def test_check_not_null():
    assert svc._check_column({"rule": "not_null", "column": "id"}, _stat("id", null_pct=0))["passed"]
    assert not svc._check_column({"rule": "not_null", "column": "id"}, _stat("id", null_pct=25))["passed"]


def test_check_unique():
    assert svc._check_column({"rule": "unique", "column": "id"}, _stat("id", distinct=4, sample_size=4))["passed"]
    assert not svc._check_column({"rule": "unique", "column": "id"}, _stat("id", distinct=3, sample_size=4))["passed"]


def test_check_range():
    exp = {"rule": "range", "column": "score", "params": {"min": 0, "max": 100}}
    assert svc._check_column(exp, _stat("score", mn=10, mx=40))["passed"]
    assert not svc._check_column(exp, _stat("score", mn=10, mx=140))["passed"]


def test_check_missing_column():
    assert not svc._check_column({"rule": "not_null", "column": "ghost"}, None)["passed"]


def test_check_unknown_rule_fails_closed():
    # An unrecognized rule must NOT silently pass a quality gate.
    assert not svc._check_column({"rule": "bogus", "column": "x"}, _stat("x"))["passed"]


# ─── End-to-end over an uploaded CSV ───

async def _upload(client: AsyncClient, auth: dict) -> str:
    csv = b"id,score\n1,10\n2,20\n3,30\n4,40\n"
    resp = await client.post(
        "/api/v1/datasource/upload",
        files={"file": ("quality.csv", csv, "text/csv")},
        headers=auth,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


async def test_contract_pass_and_fail(client: AsyncClient, auth: dict):
    ds_id = await _upload(client, auth)

    # Passing contract.
    good = await client.post(
        "/api/v1/contracts/",
        json={
            "datasource_id": ds_id, "table_name": "quality", "name": "Keyfiyyət",
            "expectations": [
                {"rule": "not_null", "column": "id"},
                {"rule": "unique", "column": "id"},
                {"rule": "range", "column": "score", "params": {"min": 0, "max": 100}},
                {"rule": "schema"},
            ],
        },
        headers=auth,
    )
    assert good.status_code == 201, good.text
    cid = good.json()["id"]

    ran = await client.post(f"/api/v1/contracts/{cid}/run", headers=auth)
    assert ran.status_code == 200, ran.text
    assert ran.json()["last_status"] == "pass"

    runs = await client.get(f"/api/v1/contracts/{cid}/runs", headers=auth)
    assert len(runs.json()) == 1 and runs.json()[0]["status"] == "pass"

    # Failing contract: score exceeds the allowed max.
    bad = await client.post(
        "/api/v1/contracts/",
        json={
            "datasource_id": ds_id, "table_name": "quality", "name": "Sərt",
            "expectations": [{"rule": "range", "column": "score", "params": {"min": 0, "max": 25}}],
        },
        headers=auth,
    )
    bid = bad.json()["id"]
    bad_run = await client.post(f"/api/v1/contracts/{bid}/run", headers=auth)
    assert bad_run.json()["last_status"] == "fail"

    # A breach raises a notification.
    notifs = await client.get("/api/v1/notifications", headers=auth)
    assert any("müqavilə" in n["title"].lower() for n in notifs.json())

    assert (await client.delete(f"/api/v1/contracts/{cid}", headers=auth)).status_code == 204

    # Delete must clean run history too (SQLite cascade is inert).
    from sqlalchemy import func, select

    from app.db.session import AsyncSessionLocal
    from app.models.data_contract import ContractRun

    async with AsyncSessionLocal() as db:
        orphans = await db.scalar(
            select(func.count()).select_from(ContractRun).where(ContractRun.contract_id == cid)
        )
    assert orphans == 0


async def test_empty_contract_is_unknown_not_pass(client: AsyncClient, auth: dict):
    ds_id = await _upload(client, auth)
    c = await client.post(
        "/api/v1/contracts/",
        json={"datasource_id": ds_id, "table_name": "quality", "name": "Boş", "expectations": []},
        headers=auth,
    )
    ran = await client.post(f"/api/v1/contracts/{c.json()['id']}/run", headers=auth)
    assert ran.json()["last_status"] == "unknown"  # nothing checked → not a green pass


async def test_contracts_require_auth(client: AsyncClient):
    assert (await client.get("/api/v1/contracts/")).status_code == 401
