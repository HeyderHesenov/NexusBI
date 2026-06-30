"""Metric tree — combine math, evaluation roll-up, CRUD + cascade."""
from __future__ import annotations

from httpx import AsyncClient

from app.services import metric_tree_service as svc


def test_combine_operators():
    assert svc._combine("add", [1, 2, 3]) == 6
    assert svc._combine("sub", [10, 3, 2]) == 5
    assert svc._combine("mul", [2, 3, 4]) == 24
    assert svc._combine("div", [100, 4, 5]) == 5  # 100 / (4*5)
    assert svc._combine("div", [10, 0]) == 0  # divide-by-zero → 0, no crash
    assert svc._combine("add", []) == 0


async def _node(client, auth, **kw):
    r = await client.post("/api/v1/metric-tree/", json=kw, headers=auth)
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def test_evaluate_rolls_up_product(client: AsyncClient, auth: dict):
    # Gəlir = Qiymət × Həcm
    root = await _node(client, auth, name="Gəlir", operator="mul")
    await _node(client, auth, name="Qiymət", parent_id=root, manual_value=20)
    await _node(client, auth, name="Həcm", parent_id=root, manual_value=15)

    ev = await client.get("/api/v1/metric-tree/evaluate", headers=auth)
    assert ev.status_code == 200, ev.text
    forest = ev.json()
    assert len(forest) == 1
    tree = forest[0]
    assert tree["name"] == "Gəlir" and tree["value"] == 300.0
    assert len(tree["children"]) == 2
    # contribution_pct is None for a × parent (share-of-parent is only meaningful for +)
    assert all(c["contribution_pct"] is None for c in tree["children"])
    # leaf manual_value is exposed (so the edit modal can pre-fill it)
    assert {c["manual_value"] for c in tree["children"]} == {20.0, 15.0}


async def test_additive_contribution(client: AsyncClient, auth: dict):
    root = await _node(client, auth, name="Cəm", operator="add")
    await _node(client, auth, name="A", parent_id=root, manual_value=75)
    await _node(client, auth, name="B", parent_id=root, manual_value=25)
    tree = (await client.get("/api/v1/metric-tree/evaluate", headers=auth)).json()[0]
    assert tree["value"] == 100.0
    a = next(c for c in tree["children"] if c["name"] == "A")
    assert a["contribution_pct"] == 75.0


async def test_delete_cascades_children(client: AsyncClient, auth: dict):
    root = await _node(client, auth, name="Kök", operator="add")
    await _node(client, auth, name="Uşaq", parent_id=root, manual_value=10)
    assert (await client.delete(f"/api/v1/metric-tree/{root}", headers=auth)).status_code == 204
    assert (await client.get("/api/v1/metric-tree/", headers=auth)).json() == []


async def test_metric_tree_requires_auth(client: AsyncClient):
    assert (await client.get("/api/v1/metric-tree/")).status_code == 401
