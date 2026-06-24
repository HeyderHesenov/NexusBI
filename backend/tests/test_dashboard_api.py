"""Dashboard CRUD API tests."""
from __future__ import annotations

from httpx import AsyncClient


async def test_dashboard_crud(client: AsyncClient, auth: dict):
    # create
    created = await client.post(
        "/api/v1/dashboard/", json={"name": "Sales", "description": "rüblük"}, headers=auth
    )
    assert created.status_code == 201
    dash_id = created.json()["id"]

    # list
    listed = await client.get("/api/v1/dashboard/", headers=auth)
    assert any(d["id"] == dash_id for d in listed.json())

    # update
    updated = await client.put(
        f"/api/v1/dashboard/{dash_id}", json={"name": "Sales 2025"}, headers=auth
    )
    assert updated.json()["name"] == "Sales 2025"

    # delete
    deleted = await client.delete(f"/api/v1/dashboard/{dash_id}", headers=auth)
    assert deleted.status_code == 204


async def test_widget_add_and_remove(client: AsyncClient, auth: dict):
    dash_id = (
        await client.post("/api/v1/dashboard/", json={"name": "D"}, headers=auth)
    ).json()["id"]

    widget = await client.post(
        f"/api/v1/dashboard/{dash_id}/widget",
        json={"query_log_id": "00000000-0000-0000-0000-000000000000", "title": "W"},
        headers=auth,
    )
    assert widget.status_code == 201
    widget_id = widget.json()["id"]

    detail = await client.get(f"/api/v1/dashboard/{dash_id}", headers=auth)
    assert len(detail.json()["widgets"]) == 1

    removed = await client.delete(
        f"/api/v1/dashboard/{dash_id}/widget/{widget_id}", headers=auth
    )
    assert removed.status_code == 204


async def test_dashboard_requires_auth(client: AsyncClient):
    resp = await client.get("/api/v1/dashboard/")
    assert resp.status_code == 401
