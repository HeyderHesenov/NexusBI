"""Nexus AI — the assistant participant in team chat.

The assistant reuses the copilot agent verbatim (same tools, same guards, same
plan→approve→execute contract as the floating widget): a user message in their
private ``ai:{user_id}`` room — or an @ai/@nexus mention in a channel by an
AI-chat-tier member — spawns a background task that asks ``copilot.plan`` and
posts the proposed plan as a chat message. Only the requester may approve; the
approval consumes one AI-quota unit and runs ``copilot.run`` scoped to the
REQUESTER's user_id, so the assistant can only ever touch what that user owns.

Assistant messages are ``ChatMessage`` rows authored by a seeded system user and
carry a server-written ``meta`` payload ({"ai": True, ...}) — the public
``chat_service.post_message`` never sets ``meta``, so AI cards can't be spoofed.
"""
from __future__ import annotations

import asyncio
import secrets
from typing import Any

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai import copilot
from app.billing import usage_service
from app.billing.tiers import has_ai_chat
from app.core.exceptions import ForbiddenError, SchemaNotFoundError
from app.core.rate_limit import check_ip
from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
from app.models.chat import ChatMessage
from app.models.user import User
from app.realtime.hub import hub
from app.schemas.chat import ChatMessageResponse
from app.services import chat_service

_log = structlog.get_logger(__name__)

ASSISTANT_EMAIL = "ai@nexusbi.io"
ASSISTANT_NAME = "Nexus AI"
#: Channel mention tokens that summon the assistant (lowercased _MENTION_RE hits).
_AI_TOKENS = {"ai", "nexus", "nexusai", ASSISTANT_EMAIL}
_HISTORY_TURNS = 10
_APOLOGY = "Bağışla, indi cavab verə bilmirəm — bir azdan yenidən yoxla."

# Keep strong references so a running reply can't be garbage-collected mid-flight.
_TASKS: set[asyncio.Task] = set()
_assistant_id: str | None = None


def _spawn(coro: Any) -> asyncio.Task:
    task = asyncio.create_task(coro)
    _TASKS.add(task)
    task.add_done_callback(_TASKS.discard)
    return task


# ─── Assistant identity ───
async def get_or_create_assistant(db: AsyncSession) -> User:
    """Idempotently fetch/seed the assistant's user row (lazy — tests skip lifespan).

    The password is random and discarded: nobody logs in as the assistant."""
    global _assistant_id
    if _assistant_id is not None:
        cached = await db.get(User, _assistant_id)
        if cached is not None:
            return cached
    user = (
        await db.execute(select(User).where(User.email == ASSISTANT_EMAIL))
    ).scalar_one_or_none()
    if user is None:
        user = User(
            email=ASSISTANT_EMAIL,
            hashed_password=hash_password(secrets.token_urlsafe(32)),
            full_name=ASSISTANT_NAME,
            subscription_tier="free",
        )
        db.add(user)
        await db.flush()
        await db.refresh(user)
    _assistant_id = user.id
    return user


# ─── Trigger detection ───
def is_ai_trigger(room_key: str, content: str) -> bool:
    """Should this just-posted human message summon the assistant?"""
    parsed = chat_service._parse_room(room_key)
    if parsed is None:
        return False
    kind = parsed[0]
    if kind == "ai":
        return True
    if kind != "channel":
        return False  # DMs stay human-to-human
    tokens = {t.lower() for t in chat_service._MENTION_RE.findall(content)}
    return bool(tokens & _AI_TOKENS)


# ─── Message plumbing ───
async def post_assistant_message(
    db: AsyncSession, room_key: str, content: str, meta: dict[str, Any]
) -> ChatMessage:
    """Persist a message AS the assistant.

    Deliberately bypasses ``post_message``'s access guard (the assistant is not a
    workspace member), mention fan-out, and its ``meta.ai`` rejection — only this
    module may set ``meta.ai``."""
    assistant = await get_or_create_assistant(db)
    msg = ChatMessage(
        room_key=room_key,
        author_id=assistant.id,
        author_name=ASSISTANT_NAME,
        content=content.strip()[:2000] or "…",
        meta=meta,
    )
    db.add(msg)
    await db.flush()
    await db.refresh(msg)
    return msg


async def _broadcast(msg: ChatMessage, frame: str = "chat") -> None:
    payload = ChatMessageResponse.model_validate(msg).model_dump(mode="json")
    await hub.broadcast(msg.room_key, {"type": frame, "message": payload})


def _typing_pulse(room_key: str, assistant_id: str) -> asyncio.Task:
    """Re-broadcast a typing hint every 2s (clients age it out at 4s) until cancelled.

    Keyed by the assistant's real user id so the reply's chat frame clears it."""

    async def pulse() -> None:
        while True:
            await hub.broadcast(
                room_key, {"type": "typing", "user_id": assistant_id, "name": ASSISTANT_NAME}
            )
            await asyncio.sleep(2)

    return asyncio.create_task(pulse())


async def _build_history(
    db: AsyncSession, room_key: str, assistant_id: str, skip_latest: int = 1
) -> list[dict[str, str]]:
    """Recent room messages as copilot turns (assistant-authored → 'assistant').

    ``skip_latest=1`` drops the just-posted trigger message (it is passed to the
    copilot separately as the current request)."""
    res = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.room_key == room_key)
        .order_by(ChatMessage.created_at.desc(), ChatMessage.id.desc())
        .limit(_HISTORY_TURNS + skip_latest)
    )
    msgs = list(res.scalars().all())[skip_latest:]
    return [
        {"role": "assistant" if m.author_id == assistant_id else "user", "content": m.content}
        for m in reversed(msgs)
    ]


async def _post_error(room_key: str) -> None:
    try:
        async with AsyncSessionLocal() as db:
            msg = await post_assistant_message(db, room_key, _APOLOGY, {"ai": True, "kind": "error"})
            await db.commit()
        await _broadcast(msg)
    except Exception:  # noqa: BLE001 — the error message is best-effort
        _log.warning("ai_chat_error_post_failed", room=room_key)


# ─── Plan (triggered by a chat message) ───
def spawn_reply(room_key: str, requester_id: str, content: str) -> asyncio.Task:
    """Fire-and-forget: never blocks or fails the user's own message post."""
    return _spawn(_plan_task(room_key, requester_id, content))


async def _plan_task(room_key: str, requester_id: str, content: str) -> None:
    pulse: asyncio.Task | None = None
    try:
        async with AsyncSessionLocal() as db:
            requester = await db.get(User, requester_id)
            # Silent no-ops: a mention by a non-tier member simply doesn't summon
            # the AI, and a flooding requester is throttled without fanfare.
            if requester is None or not has_ai_chat(requester.subscription_tier):
                return
            if not check_ip("ai_chat_plan", requester_id, limit=6, window_seconds=60):
                return
            assistant = await get_or_create_assistant(db)
            await db.commit()  # the assistant row must survive even if planning fails
            pulse = _typing_pulse(room_key, assistant.id)
            history = await _build_history(db, room_key, assistant.id)
            result = await copilot.plan(content, history)
            pulse.cancel()
            pulse = None
            meta = {
                "ai": True,
                "kind": "plan",
                "plan": result.get("plan") or [],
                "pending_message": content[:2000],
                "requester_id": requester_id,
                "status": "pending",
            }
            msg = await post_assistant_message(
                db, room_key, result.get("reply") or "Plan hazırdır — təsdiqlə.", meta
            )
            await db.commit()
        await _broadcast(msg)
    except Exception as exc:  # noqa: BLE001 — a failed reply must stay visible, not silent
        _log.warning("ai_chat_plan_failed", error=type(exc).__name__, detail=str(exc)[:200])
        await _post_error(room_key)
    finally:
        if pulse is not None:
            pulse.cancel()


# ─── Approve / cancel (HTTP, requester-only) ───
async def _load_pending_plan(db: AsyncSession, user: User, message_id: str) -> ChatMessage:
    msg = await db.get(ChatMessage, message_id)
    if msg is None or not isinstance(msg.meta, dict) or msg.meta.get("kind") != "plan":
        raise SchemaNotFoundError("Plan mesajı tapılmadı.")
    if not await chat_service.can_access_room(db, user.id, msg.room_key):
        raise SchemaNotFoundError("Otağa giriş yoxdur.")
    if msg.meta.get("requester_id") != user.id:
        raise ForbiddenError("Bu planı yalnız istəyi göndərən idarə edə bilər.")
    if msg.meta.get("status") != "pending":
        raise ForbiddenError("Bu plan artıq həll olunub.")
    return msg


async def approve(db: AsyncSession, user: User, message_id: str) -> ChatMessage:
    """Requester approves → consume one AI-quota unit and mark the plan approved.

    The caller commits, broadcasts the ``chat_update`` and spawns the execution."""
    msg = await _load_pending_plan(db, user, message_id)
    await usage_service.check_and_consume(db, user)
    # JSON columns don't track in-place mutation — always reassign.
    msg.meta = {**msg.meta, "status": "approved"}
    await db.flush()
    return msg


async def cancel(db: AsyncSession, user: User, message_id: str) -> ChatMessage:
    msg = await _load_pending_plan(db, user, message_id)
    msg.meta = {**msg.meta, "status": "cancelled"}
    await db.flush()
    return msg


# ─── Execute (background, after approval) ───
def spawn_execute(cache: Any, msg: ChatMessage, client_ip: str) -> asyncio.Task:
    meta = msg.meta or {}
    return _spawn(
        _execute_task(
            cache,
            msg.room_key,
            msg.id,
            str(meta.get("requester_id") or ""),
            str(meta.get("pending_message") or ""),
            list(meta.get("plan") or []),
            client_ip,
        )
    )


async def _execute_task(
    cache: Any,
    room_key: str,
    plan_msg_id: str,
    requester_id: str,
    pending_message: str,
    plan: list[dict[str, str]],
    client_ip: str,
) -> None:
    pulse: asyncio.Task | None = None
    try:
        async with AsyncSessionLocal() as db:
            assistant = await get_or_create_assistant(db)
            pulse = _typing_pulse(room_key, assistant.id)
            # skip_latest=0: history ends at the plan reply; the approved request
            # is passed as the current message.
            history = await _build_history(db, room_key, assistant.id, skip_latest=0)
            result = await copilot.run(
                pending_message, history, db, cache, requester_id, plan or None,
                client_ip=client_ip,
            )
            pulse.cancel()
            pulse = None
            msg = await post_assistant_message(
                db,
                room_key,
                result.get("reply") or "Hazırdır.",
                {
                    "ai": True,
                    "kind": "actions",
                    "actions": result.get("actions") or [],
                    "requester_id": requester_id,
                },
            )
            await db.commit()
        await _broadcast(msg)
    except Exception as exc:  # noqa: BLE001 — flip the card to failed + apologise visibly
        _log.warning("ai_chat_execute_failed", error=type(exc).__name__, detail=str(exc)[:200])
        try:
            async with AsyncSessionLocal() as db:
                plan_msg = await db.get(ChatMessage, plan_msg_id)
                if plan_msg is not None and isinstance(plan_msg.meta, dict):
                    plan_msg.meta = {**plan_msg.meta, "status": "failed"}
                    await db.commit()
            if plan_msg is not None and isinstance(plan_msg.meta, dict):
                await _broadcast(plan_msg, "chat_update")
        except Exception:  # noqa: BLE001
            _log.warning("ai_chat_fail_mark_failed", message=plan_msg_id)
        await _post_error(room_key)
    finally:
        if pulse is not None:
            pulse.cancel()
