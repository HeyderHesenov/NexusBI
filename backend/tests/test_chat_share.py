"""Share-to-chat: ownership + room guards, chart snapshot embed, card meta."""
from __future__ import annotations

from typing import get_args

import pytest
from httpx import AsyncClient

from app.ai.types import ChartConfig, Text2SQLResult
from app.schemas.chat import ShareResourceType
from app.services import chat_service, chat_share_service, query_service


@pytest.fixture(autouse=True)
def _mock_ai(monkeypatch):
    async def fake_sql(self, nl, schema, dtype="sqlite", extra_context=""):
        return Text2SQLResult(
            sql="SELECT product_name, SUM(revenue) AS total FROM sales "
                "GROUP BY product_name ORDER BY total DESC LIMIT 5",
            explanation="demo", confidence=0.9, warnings=[],
        )

    async def fake_chart(columns, data, nl):
        return ChartConfig(chart_type="bar", x_axis="product_name", y_axis="total")

    async def fake_insight(data, nl, chart_type=""):
        return "Ən çox satan məhsul liderdir."

    monkeypatch.setattr(query_service.Text2SQLEngine, "generate_sql", fake_sql)
    monkeypatch.setattr(query_service, "select_chart_type", fake_chart)
    monkeypatch.setattr(query_service, "generate_insight", fake_insight)


async def _register(client: AsyncClient, email: str, name: str | None = None) -> str:
    resp = await client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": "pw1234", "full_name": name or email.split("@")[0]},
    )
    return resp.json()["access_token"]


async def _channel_room(client: AsyncClient, auth: dict) -> str:
    ws_id = (
        await client.post("/api/v1/workspaces", json={"name": "Paylaşım"}, headers=auth)
    ).json()["id"]
    ch = await client.post(
        f"/api/v1/workspaces/{ws_id}/channels", json={"name": "ümumi"}, headers=auth
    )
    return chat_service.channel_room(ws_id, ch.json()["id"])


async def _ask(client: AsyncClient, auth: dict, nl: str = "Ən çox satan 5 məhsul") -> str:
    resp = await client.post(
        "/api/v1/query/ask", json={"nl_query": nl, "datasource_id": None}, headers=auth
    )
    return resp.json()["query_log_id"]


async def _share(client: AsyncClient, auth: dict, **overrides):
    payload = {"room_key": "", "resource_type": "query_log", "resource_id": "", "caption": ""}
    payload.update(overrides)
    return await client.post("/api/v1/chat/share", json=payload, headers=auth)


async def test_share_query_log_embeds_chart_snapshot(client: AsyncClient, auth: dict):
    room = await _channel_room(client, auth)
    qid = await _ask(client, auth)

    resp = await _share(client, auth, room_key=room, resource_id=qid, caption="Buna baxın")
    assert resp.status_code == 201, resp.text
    meta = resp.json()["meta"]
    assert meta["kind"] == "share" and meta["resource_type"] == "query_log"
    assert "ai" not in meta  # share cards must never masquerade as AI cards
    assert meta["caption"] == "Buna baxın"
    assert meta["chart"]["chart_config"]["chart_type"] == "bar"
    assert len(meta["chart"]["data"]) == 5
    assert "truncated" not in meta["chart"]  # nothing was dropped
    assert "sql" not in meta["chart"]  # the card is a picture, not a code disclosure
    assert resp.json()["content"] == "Buna baxın"

    # The card round-trips through history for every member fetch.
    hist = (await client.get(f"/api/v1/chat/history?room_key={room}", headers=auth)).json()
    assert any(m["meta"] and m["meta"].get("kind") == "share" for m in hist)


async def test_share_snapshot_respects_chat_row_cap(client: AsyncClient, auth: dict, monkeypatch):
    monkeypatch.setattr(chat_share_service, "_CHAT_MAX_ROWS", 2)
    room = await _channel_room(client, auth)
    qid = await _ask(client, auth)
    chart = (await _share(client, auth, room_key=room, resource_id=qid)).json()["meta"]["chart"]
    assert len(chart["data"]) == 2
    assert chart["truncated"] is True  # the card must admit it dropped rows


async def test_share_caption_falls_back_to_title(client: AsyncClient, auth: dict):
    room = await _channel_room(client, auth)
    qid = await _ask(client, auth, nl="Aylıq gəlir")
    no_caption = await _share(client, auth, room_key=room, resource_id=qid)
    assert no_caption.json()["content"] == "Aylıq gəlir"
    assert no_caption.json()["meta"]["caption"] == ""  # explicit: no user note
    padded = await _share(client, auth, room_key=room, resource_id=qid, caption="  qeyd  ")
    assert padded.json()["content"] == "qeyd"
    assert padded.json()["meta"]["caption"] == "qeyd"


async def test_share_into_dm_and_ai_room(client: AsyncClient, auth: dict, db_session):
    from app.models.user import User
    from sqlalchemy import select

    ws_id = (
        await client.post("/api/v1/workspaces", json={"name": "DM ws"}, headers=auth)
    ).json()["id"]
    await _register(client, "peer@nexusbi.io")
    await client.post(
        f"/api/v1/workspaces/{ws_id}/members",
        json={"email": "peer@nexusbi.io", "role": "viewer"}, headers=auth,
    )
    me = (await client.get("/api/v1/auth/me", headers=auth)).json()
    peer_id = (
        await db_session.execute(select(User.id).where(User.email == "peer@nexusbi.io"))
    ).scalar_one()
    qid = await _ask(client, auth)

    dm = await _share(
        client, auth, room_key=chat_service.dm_room(me["id"], peer_id), resource_id=qid
    )
    assert dm.status_code == 201

    # AI room is tier-gated like every other access to it.
    ai_room = chat_service.ai_room(me["id"])
    assert (
        await _share(client, auth, room_key=ai_room, resource_id=qid)
    ).status_code == 404  # free tier
    user = await db_session.get(User, me["id"])
    user.subscription_tier = "max"
    await db_session.commit()
    assert (
        await _share(client, auth, room_key=ai_room, resource_id=qid)
    ).status_code == 201


async def test_share_rejects_foreign_resource_and_room(client: AsyncClient, auth: dict):
    room = await _channel_room(client, auth)

    # Someone else's query log: not yours → it doesn't exist for you.
    t2 = await _register(client, "other@nexusbi.io")
    auth2 = {"Authorization": f"Bearer {t2}"}
    foreign_qid = await _ask(client, auth2)
    assert (
        await _share(client, auth, room_key=room, resource_id=foreign_qid)
    ).status_code == 404

    # A room you're not a member of, and a malformed room key.
    own_qid = await _ask(client, auth)
    assert (
        await _share(client, auth2, room_key=room, resource_id=await _ask(client, auth2))
    ).status_code == 404
    assert (
        await _share(client, auth, room_key="qarabag", resource_id=own_qid)
    ).status_code == 404

    # Unknown resource type is a validation error, not a 500.
    bad = await client.post(
        "/api/v1/chat/share",
        json={"room_key": room, "resource_type": "spaceship", "resource_id": own_qid},
        headers=auth,
    )
    assert bad.status_code == 422


async def test_share_reference_cards_for_other_types(client: AsyncClient, auth: dict):
    room = await _channel_room(client, auth)

    dash_id = (
        await client.post("/api/v1/dashboard/", json={"name": "Satış paneli"}, headers=auth)
    ).json()["id"]
    decision_id = (
        await client.post(
            "/api/v1/decisions/",
            json={"title": "Qərbdə düşüş", "insight": "Gəlir düşdü", "action": "Reklam artır"},
            headers=auth,
        )
    ).json()["id"]
    metric_id = (
        await client.post(
            "/api/v1/metrics/",
            json={"name": "Gəlir", "expression": "SUM(revenue)", "synonyms": ""},
            headers=auth,
        )
    ).json()["id"]

    for rtype, rid, title, subtitle in [
        ("dashboard", dash_id, "Satış paneli", ""),
        ("decision", decision_id, "Qərbdə düşüş", "open"),
        ("metric", metric_id, "Gəlir", "SUM(revenue)"),
    ]:
        resp = await _share(client, auth, room_key=room, resource_type=rtype, resource_id=rid)
        assert resp.status_code == 201, f"{rtype}: {resp.text}"
        meta = resp.json()["meta"]
        assert meta["title"] == title and meta["subtitle"] == subtitle
        assert "chart" not in meta  # reference cards carry no data payload


def test_loader_registry_covers_every_share_type():
    assert set(chat_share_service._LOADERS) == set(get_args(ShareResourceType))


async def test_post_message_rejects_ai_meta(db_session):
    # The "AI cards are unspoofable" invariant is mechanical: no caller of
    # post_message — share cards included — can smuggle in `meta.ai`.
    with pytest.raises(ValueError):
        await chat_service.post_message(
            db_session, "dm:a:b", "u1", "Kimsə", "salam", meta={"ai": True}
        )


async def test_share_is_rate_limited(client: AsyncClient, auth: dict):
    room = await _channel_room(client, auth)
    qid = await _ask(client, auth)
    codes = [
        (await _share(client, auth, room_key=room, resource_id=qid)).status_code
        for _ in range(11)
    ]
    assert codes[:10] == [201] * 10 and codes[10] == 429


async def test_share_writes_an_audit_row(client: AsyncClient, auth: dict, db_session):
    from app.models.workspace import AuditLog
    from sqlalchemy import select

    room = await _channel_room(client, auth)
    qid = await _ask(client, auth)
    await _share(client, auth, room_key=room, resource_id=qid)

    row = (
        await db_session.execute(select(AuditLog).where(AuditLog.action == "chat.share"))
    ).scalars().first()
    assert row is not None and row.meta["resource_type"] == "query_log"
