"""Scheduled PDF/Excel report delivery — rendering, subscriptions, due-run."""
from __future__ import annotations

import pytest
from httpx import AsyncClient

pytestmark = pytest.mark.asyncio


async def test_render_produces_valid_files():
    from app.services import report_renderer

    cols, rows = ["region", "revenue"], [{"region": "North", "revenue": 100}]
    xlsx, xname, xmime = report_renderer.render("xlsx", "Region hesabatı", cols, rows)
    assert xlsx[:2] == b"PK"  # xlsx is a zip
    assert xname.endswith(".xlsx") and "spreadsheet" in xmime

    pdf, pname, pmime = report_renderer.render("pdf", "Region hesabatı", cols, rows)
    assert pdf[:4] == b"%PDF"
    assert pname.endswith(".pdf") and pmime == "application/pdf"


async def test_render_handles_empty_columns():
    from app.services import report_renderer

    xlsx, _, _ = report_renderer.render("xlsx", "Boş", [], [])
    assert xlsx[:2] == b"PK"
    pdf, _, _ = report_renderer.render("pdf", "Boş", [], [])
    assert pdf[:4] == b"%PDF"  # no crash on a zero-column grid


async def _saved(client: AsyncClient, auth: dict) -> str:
    r = await client.post(
        "/api/v1/saved/", json={"name": "Region", "nl_query": "region üzrə satış"}, headers=auth
    )
    return r.json()["id"]


async def test_subscription_crud(client: AsyncClient, auth: dict):
    sid = await _saved(client, auth)
    created = await client.post(
        f"/api/v1/saved/{sid}/subscriptions",
        json={"recipient": "boss@corp.com", "format": "pdf", "schedule": "daily"},
        headers=auth,
    )
    assert created.status_code == 201, created.text
    sub_id = created.json()["id"]

    listed = await client.get(f"/api/v1/saved/{sid}/subscriptions", headers=auth)
    assert len(listed.json()) == 1
    assert listed.json()[0]["recipient"] == "boss@corp.com"

    deleted = await client.delete(f"/api/v1/saved/subscriptions/{sub_id}", headers=auth)
    assert deleted.status_code == 204
    assert (await client.get(f"/api/v1/saved/{sid}/subscriptions", headers=auth)).json() == []


async def test_subscription_rejects_bad_email(client: AsyncClient, auth: dict):
    sid = await _saved(client, auth)
    resp = await client.post(
        f"/api/v1/saved/{sid}/subscriptions", json={"recipient": "notanemail"}, headers=auth
    )
    assert resp.status_code == 422


async def test_subscription_rejects_header_injection(client: AsyncClient, auth: dict):
    sid = await _saved(client, auth)
    resp = await client.post(
        f"/api/v1/saved/{sid}/subscriptions",
        json={"recipient": "a@b.com\nBcc: evil@x.com"},
        headers=auth,
    )
    assert resp.status_code == 422


async def test_subscription_scoped_to_owner(client: AsyncClient, auth: dict):
    sid = await _saved(client, auth)
    other = await client.post(
        "/api/v1/auth/register",
        json={"email": "intruder2@nexusbi.io", "password": "pw1234", "full_name": "X"},
    )
    other_auth = {"Authorization": f"Bearer {other.json()['access_token']}"}
    resp = await client.post(
        f"/api/v1/saved/{sid}/subscriptions", json={"recipient": "x@y.com"}, headers=other_auth
    )
    assert resp.status_code == 404  # not the owner's saved query


async def test_run_deliveries_due_sends_and_stamps(client: AsyncClient, auth: dict):
    from app.db.session import AsyncSessionLocal
    from app.services import report_delivery_service
    from app.services.cache_service import CacheService

    sid = await _saved(client, auth)
    await client.post(f"/api/v1/saved/{sid}/run", headers=auth)  # populate result_data
    await client.post(
        f"/api/v1/saved/{sid}/subscriptions", json={"recipient": "boss@corp.com"}, headers=auth
    )

    async with AsyncSessionLocal() as db:
        # INTEGRATIONS_LIVE defaults False → mock delivery, nothing leaves the box.
        sent = await report_delivery_service.run_deliveries_due(db, CacheService(None))
        await db.commit()
    assert sent == 1

    # A second immediate run is not due (daily cadence just stamped).
    async with AsyncSessionLocal() as db:
        again = await report_delivery_service.run_deliveries_due(db, CacheService(None))
        await db.commit()
    assert again == 0
