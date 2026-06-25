"""Decision (Insight → Action → Outcome) CRUD."""
from __future__ import annotations

from httpx import AsyncClient


async def test_decision_lifecycle(client: AsyncClient, auth: dict):
    created = await client.post(
        "/api/v1/decisions/",
        json={"title": "Qərbdə düşüş", "insight": "Gəlir 12% düşdü", "action": "Reklam artır"},
        headers=auth,
    )
    assert created.status_code == 201, created.text
    did = created.json()["id"]
    assert created.json()["status"] == "open"

    listed = await client.get("/api/v1/decisions/", headers=auth)
    assert any(d["id"] == did for d in listed.json())

    upd = await client.put(
        f"/api/v1/decisions/{did}",
        json={"status": "done", "outcome": "Gəlir bərpa olundu"},
        headers=auth,
    )
    assert upd.json()["status"] == "done"
    assert upd.json()["outcome"] == "Gəlir bərpa olundu"

    assert (await client.delete(f"/api/v1/decisions/{did}", headers=auth)).status_code == 204


async def test_decisions_require_auth(client: AsyncClient):
    assert (await client.get("/api/v1/decisions/")).status_code == 401
