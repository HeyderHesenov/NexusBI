"""NL data-prep (preview/materialize) + profiling tests."""
from __future__ import annotations

import pytest

from app.ai import data_prep
from app.services import profiling_service

_SQL = "SELECT product_name, SUM(revenue) AS total FROM sales GROUP BY product_name"


@pytest.fixture(autouse=True)
def _mock_plan(monkeypatch):
    async def fake_chat_json(system, user, **kw):
        return {"sql": _SQL, "steps": ["sales qruplandı"], "warnings": []}

    monkeypatch.setattr(data_prep, "chat_json", fake_chat_json)


def test_profile_rows_stats():
    rows = [
        {"region": "West", "amount": 100},
        {"region": "East", "amount": None},
        {"region": "West", "amount": 50},
    ]
    out = profiling_service._profile_rows(["region", "amount"], rows)
    region = next(c for c in out if c["column"] == "region")
    amount = next(c for c in out if c["column"] == "amount")
    assert region["dtype"] == "text"
    assert region["distinct"] == 2
    assert amount["dtype"] == "number"
    assert amount["null_pct"] == pytest.approx(33.3, abs=0.2)
    assert amount["max"] == 100


def test_data_prep_rule_based_passthrough():
    schema = "- sales(product_name (TEXT), revenue (REAL))\n- customers(id (INT))"
    out = data_prep._rule_based(schema, "sales cədvəlini göstər")
    assert "sales" in out["sql"].lower()
    assert out["warnings"]


async def test_preview_demo(client, auth):
    resp = await client.post(
        "/api/v1/dataprep/preview",
        json={"datasource_id": None, "instruction": "məhsul üzrə gəlir"},
        headers=auth,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["sql"] == _SQL
    assert body["columns"]
    assert body["rows"]


async def test_materialize_then_profile(client, auth):
    # Materialize the demo transform into a new SQLite datasource.
    mat = await client.post(
        "/api/v1/dataprep/materialize",
        json={"datasource_id": None, "sql": _SQL, "name": "derived_demo"},
        headers=auth,
    )
    assert mat.status_code == 201, mat.text
    ds_id = mat.json()["id"]

    # It shows up as a normal datasource and can be profiled.
    profile = await client.get(
        f"/api/v1/datasource/{ds_id}/profile",
        params={"table": "derived_demo"},
        headers=auth,
    )
    assert profile.status_code == 200, profile.text
    body = profile.json()
    cols = {c["column"] for c in body["columns"]}
    assert "product_name" in cols
    assert any(c["dtype"] == "number" for c in body["columns"])


async def test_materialize_rejects_non_select(client, auth):
    resp = await client.post(
        "/api/v1/dataprep/materialize",
        json={"datasource_id": None, "sql": "DROP TABLE sales", "name": "x"},
        headers=auth,
    )
    assert resp.status_code >= 400
