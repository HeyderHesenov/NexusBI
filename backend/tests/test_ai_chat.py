"""Nexus AI in team chat: tier gating, plan trigger, approve/execute/cancel."""
from __future__ import annotations

import asyncio

from httpx import AsyncClient
from sqlalchemy import func, select

from app.ai import copilot
from app.billing.tiers import get_tier
from app.models.chat import ChatMessage
from app.models.user import User
from app.services import ai_chat_service, chat_service


async def _register(client: AsyncClient, email: str, name: str | None = None) -> str:
    resp = await client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": "pw1234", "full_name": name or email.split("@")[0]},
    )
    return resp.json()["access_token"]


async def _me(client: AsyncClient, headers: dict) -> dict:
    return (await client.get("/api/v1/auth/me", headers=headers)).json()


async def _set_tier(db_session, user_id: str, tier: str) -> None:
    user = await db_session.get(User, user_id)
    user.subscription_tier = tier
    await db_session.commit()


def _mock_plan(monkeypatch, reply: str = "Bu addımları atacam.") -> None:
    async def fake_plan(message, history):
        return {"plan": [{"tool": "run_query", "summary": message[:60]}], "reply": reply}

    monkeypatch.setattr(copilot, "plan", fake_plan)


def _mock_run(monkeypatch, reply: str = "Hazırdır.") -> None:
    async def fake_run(message, history, db, cache, user_id, approved_plan=None, client_ip=""):
        return {
            "reply": reply,
            "actions": [{"type": "dashboard", "label": "Panel", "dashboard_id": "d1"}],
            "steps": 2,
        }

    monkeypatch.setattr(copilot, "run", fake_run)


async def _seed_plan_message(db_session, room: str, requester_id: str) -> ChatMessage:
    msg = await ai_chat_service.post_assistant_message(
        db_session,
        room,
        "Plan hazırdır.",
        {
            "ai": True,
            "kind": "plan",
            "plan": [{"tool": "run_query", "summary": "gəlir"}],
            "pending_message": "gəliri göstər",
            "requester_id": requester_id,
            "status": "pending",
        },
    )
    await db_session.commit()
    return msg


async def test_me_exposes_ai_chat_flag(client: AsyncClient, auth: dict, db_session):
    me = await _me(client, auth)
    assert me["ai_chat"] is False  # fresh accounts are free tier
    await _set_tier(db_session, me["id"], "max")
    assert (await _me(client, auth))["ai_chat"] is True


async def test_ai_room_access_is_tier_gated(client: AsyncClient, auth: dict, db_session):
    me = await _me(client, auth)
    room = chat_service.ai_room(me["id"])

    # Free tier: the room simply doesn't exist for you.
    denied = await client.post("/api/v1/chat/ticket", json={"room_key": room}, headers=auth)
    assert denied.status_code == 404

    await _set_tier(db_session, me["id"], "max")
    ok = await client.post("/api/v1/chat/ticket", json={"room_key": room}, headers=auth)
    assert ok.status_code == 200 and ok.json()["ticket"]

    # Someone else's AI room stays closed even on the top tier.
    other = chat_service.ai_room("someone-else")
    assert (
        await client.post("/api/v1/chat/ticket", json={"room_key": other}, headers=auth)
    ).status_code == 404


async def test_is_ai_trigger_truth_table():
    ai = chat_service.ai_room("u1")
    ch = chat_service.channel_room("w1", "c1")
    dm = chat_service.dm_room("u1", "u2")
    assert ai_chat_service.is_ai_trigger(ai, "salam") is True
    assert ai_chat_service.is_ai_trigger(ch, "@ai gəliri göstər") is True
    assert ai_chat_service.is_ai_trigger(ch, "salam @nexus") is True
    assert ai_chat_service.is_ai_trigger(ch, "adi mesaj") is False
    assert ai_chat_service.is_ai_trigger(dm, "@ai salam") is False  # DMs stay human
    assert ai_chat_service.is_ai_trigger("qarabag", "@ai") is False


async def test_ai_room_trigger_posts_plan_message(
    client: AsyncClient, auth: dict, db_session, monkeypatch
):
    me = await _me(client, auth)
    await _set_tier(db_session, me["id"], "max")
    _mock_plan(monkeypatch)
    room = chat_service.ai_room(me["id"])

    await ai_chat_service.spawn_reply(room, me["id"], "gəliri göstər")

    hist = (await client.get(f"/api/v1/chat/history?room_key={room}", headers=auth)).json()
    assert len(hist) == 1
    msg = hist[0]
    assert msg["author_name"] == ai_chat_service.ASSISTANT_NAME
    # meta round-trips through the API (plan card payload for the frontend).
    assert msg["meta"]["ai"] is True and msg["meta"]["kind"] == "plan"
    assert msg["meta"]["status"] == "pending"
    assert msg["meta"]["pending_message"] == "gəliri göstər"
    assert msg["meta"]["requester_id"] == me["id"]


async def test_channel_mention_by_tier_member_posts_plan(
    client: AsyncClient, auth: dict, db_session, monkeypatch
):
    me = await _me(client, auth)
    await _set_tier(db_session, me["id"], "max_plus")
    _mock_plan(monkeypatch)
    ws_id = (
        await client.post("/api/v1/workspaces", json={"name": "AI ws"}, headers=auth)
    ).json()["id"]
    ch = await client.post(
        f"/api/v1/workspaces/{ws_id}/channels", json={"name": "ümumi"}, headers=auth
    )
    room = chat_service.channel_room(ws_id, ch.json()["id"])

    await ai_chat_service.spawn_reply(room, me["id"], "@ai satışları analiz et")

    hist = (await client.get(f"/api/v1/chat/history?room_key={room}", headers=auth)).json()
    assert any(
        m["author_name"] == ai_chat_service.ASSISTANT_NAME and m["meta"]["kind"] == "plan"
        for m in hist
    )


async def test_plan_task_is_silent_for_free_tier(
    client: AsyncClient, auth: dict, db_session, monkeypatch
):
    me = await _me(client, auth)  # free tier
    _mock_plan(monkeypatch)
    room = chat_service.ai_room(me["id"])

    await ai_chat_service.spawn_reply(room, me["id"], "gəliri göstər")

    count = (
        await db_session.execute(
            select(func.count()).select_from(ChatMessage).where(ChatMessage.room_key == room)
        )
    ).scalar_one()
    assert count == 0


async def test_approve_executes_and_posts_actions(
    client: AsyncClient, auth: dict, db_session, monkeypatch
):
    me = await _me(client, auth)
    await _set_tier(db_session, me["id"], "max")
    _mock_run(monkeypatch)
    room = chat_service.ai_room(me["id"])
    plan_msg = await _seed_plan_message(db_session, room, me["id"])

    resp = await client.post(
        "/api/v1/chat/ai/approve", json={"message_id": plan_msg.id}, headers=auth
    )
    assert resp.status_code == 202, resp.text
    await asyncio.gather(*list(ai_chat_service._TASKS))  # let the executor finish

    hist = (await client.get(f"/api/v1/chat/history?room_key={room}", headers=auth)).json()
    plan = next(m for m in hist if m["id"] == plan_msg.id)
    assert plan["meta"]["status"] == "approved"  # persisted, not just broadcast
    result = next(m for m in hist if m["meta"] and m["meta"]["kind"] == "actions")
    assert result["meta"]["actions"][0]["dashboard_id"] == "d1"

    # Execution consumed exactly one quota unit (max tier counts, unlike demo).
    db_session.expire_all()
    user = await db_session.get(User, me["id"])
    assert user.ai_calls_used == 1


async def test_approve_is_requester_only(client: AsyncClient, auth: dict, db_session):
    me = await _me(client, auth)
    await _set_tier(db_session, me["id"], "max")
    room = chat_service.ai_room(me["id"])
    plan_msg = await _seed_plan_message(db_session, room, me["id"])

    t2 = await _register(client, "impostor@nexusbi.io")
    auth2 = {"Authorization": f"Bearer {t2}"}
    me2 = await _me(client, auth2)
    await _set_tier(db_session, me2["id"], "max")

    # Even on the right tier: it's not their room, so it doesn't exist for them.
    denied = await client.post(
        "/api/v1/chat/ai/approve", json={"message_id": plan_msg.id}, headers=auth2
    )
    assert denied.status_code == 404


async def test_cancel_blocks_later_approve(client: AsyncClient, auth: dict, db_session):
    me = await _me(client, auth)
    await _set_tier(db_session, me["id"], "max")
    room = chat_service.ai_room(me["id"])
    plan_msg = await _seed_plan_message(db_session, room, me["id"])

    cancelled = await client.post(
        "/api/v1/chat/ai/cancel", json={"message_id": plan_msg.id}, headers=auth
    )
    assert cancelled.status_code == 200

    hist = (await client.get(f"/api/v1/chat/history?room_key={room}", headers=auth)).json()
    assert next(m for m in hist if m["id"] == plan_msg.id)["meta"]["status"] == "cancelled"

    # A resolved plan can't be approved anymore.
    stale = await client.post(
        "/api/v1/chat/ai/approve", json={"message_id": plan_msg.id}, headers=auth
    )
    assert stale.status_code == 403


async def test_approve_respects_quota(client: AsyncClient, auth: dict, db_session):
    me = await _me(client, auth)
    await _set_tier(db_session, me["id"], "max")
    user = await db_session.get(User, me["id"])
    user.ai_calls_used = get_tier("max").monthly_quota  # window exhausted
    from datetime import datetime, timezone

    user.usage_period_start = datetime.now(timezone.utc)
    await db_session.commit()

    room = chat_service.ai_room(me["id"])
    plan_msg = await _seed_plan_message(db_session, room, me["id"])
    resp = await client.post(
        "/api/v1/chat/ai/approve", json={"message_id": plan_msg.id}, headers=auth
    )
    assert resp.status_code == 429


async def test_assistant_user_is_idempotent(db_session):
    first = await ai_chat_service.get_or_create_assistant(db_session)
    second = await ai_chat_service.get_or_create_assistant(db_session)
    await db_session.commit()
    assert first.id == second.id
    count = (
        await db_session.execute(
            select(func.count())
            .select_from(User)
            .where(User.email == ai_chat_service.ASSISTANT_EMAIL)
        )
    ).scalar_one()
    assert count == 1
