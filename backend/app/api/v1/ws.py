"""WebSocket endpoint for live dashboard collaboration (cursors + team chat)."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import select

from app.core.logging import get_logger
from app.core.rate_limit import check_ip
from app.core.security import assert_access_token, decode_access_token
from app.db.session import AsyncSessionLocal
from app.models.dashboard import Dashboard
from app.models.user import User
from app.realtime import notify
from app.realtime.hub import Connection, Participant, hub
from app.schemas.comment import CommentResponse
from app.services import ai_chat_service, chat_service, comment_service

router = APIRouter()
_log = get_logger("nexusbi.realtime")

_COLORS = ["#10B981", "#6366F1", "#F59E0B", "#EF4444", "#EC4899", "#14B8A6", "#8B5CF6", "#F97316"]

# Pre-auth, per-IP handshake gate. Deliberately generous: this bucket is shared by
# everyone behind one NAT (and by every reverse proxy that doesn't forward the peer
# IP), while ordinary use spends it fast — one hit per room switch, per dashboard
# visit, and per tab's mailbox. Its stated job is stopping share-token brute force,
# and a share_token is secrets.token_urlsafe(24) = 192 bits, so the limit is not
# what makes that infeasible. Per-user caps below are the real bound.
_IP_CONNECTS = 300
_guest_seq = 0


async def _resolve_access(
    dashboard_id: str, token: str | None, share: str | None, ticket: str | None
) -> tuple[str | None, str | None] | None:
    """Return (user_id, display_name) if access is granted, else None.

    Owner authenticates with a short-lived ws ticket (preferred) or a JWT — both
    must own the dashboard; a share-link guest authenticates with the dashboard's
    share_token (user_id=None, name=None).
    """
    async with AsyncSessionLocal() as db:
        dash = (
            await db.execute(select(Dashboard).where(Dashboard.id == dashboard_id))
        ).scalar_one_or_none()
        if dash is None:
            return None
        # Try owner auth first (ticket, then legacy JWT). If neither grants access,
        # fall through to the share token so a logged-in visitor can still join.
        for cred, scoped in ((ticket, True), (token, False)):
            if not cred:
                continue
            try:
                payload = decode_access_token(cred)
                if scoped:
                    # A ticket is bound to one dashboard; reject it for any other.
                    if payload.get("ws") != dashboard_id:
                        continue
                else:
                    # The ?token= slot skips the binding check, so it must accept
                    # ONLY a real access token — otherwise any scoped ticket becomes
                    # a general credential here.
                    assert_access_token(payload)
            except Exception:  # noqa: BLE001 — bad cred just isn't owner auth
                continue
            user = (
                await db.execute(select(User).where(User.id == payload.get("sub")))
            ).scalar_one_or_none()
            if user and user.id == dash.user_id:
                return user.id, (user.full_name or user.email)
        if share and dash.share_token and share == dash.share_token:
            return None, None  # guest via share link
        return None


@router.websocket("/dashboard/{dashboard_id}")
async def dashboard_ws(ws: WebSocket, dashboard_id: str) -> None:
    global _guest_seq
    # Throttle connection attempts per IP so share tokens can't be brute-forced
    # over a flood of WebSocket handshakes.
    ip = ws.client.host if ws.client else "unknown"
    if not check_ip("ws_connect", ip, limit=_IP_CONNECTS, window_seconds=60):
        await ws.close(code=4429)
        return
    access = await _resolve_access(
        dashboard_id,
        ws.query_params.get("token"),
        ws.query_params.get("share"),
        ws.query_params.get("ticket"),
    )
    if access is None:
        await ws.close(code=4401)
        return

    await ws.accept()
    user_id, name = access
    if name is None:
        _guest_seq += 1
        name = f"Qonaq {_guest_seq}"
    conn_id = uuid.uuid4().hex[:8]
    color = _COLORS[hash(conn_id) % len(_COLORS)]
    conn = Connection(
        ws=ws, participant=Participant(conn_id=conn_id, user_id=user_id, name=name, color=color)
    )
    await hub.connect(dashboard_id, conn)
    try:
        while True:
            try:
                msg = await ws.receive_json()
            except WebSocketDisconnect:
                raise
            except Exception:  # noqa: BLE001 — skip a malformed frame, keep the session
                continue
            kind = msg.get("type")
            if kind == "cursor":
                # Ephemeral — never persisted.
                await hub.broadcast(
                    dashboard_id,
                    {
                        "type": "cursor",
                        "conn_id": conn_id,
                        "name": name,
                        "color": color,
                        "x": msg.get("x"),
                        "y": msg.get("y"),
                    },
                    exclude=conn,
                )
            elif kind == "chat":
                text = (msg.get("text") or "").strip()
                if not text:
                    continue
                # Throttle persisted chat so a share-link guest can't flood the
                # dashboard_comments table (per-IP, bounded in-memory limiter).
                if not check_ip("ws_chat", ip, limit=20, window_seconds=10):
                    await ws.send_json({"type": "throttled"})
                    continue
                async with AsyncSessionLocal() as db:
                    comment = await comment_service.create(
                        db, dashboard_id, user_id, name, text, msg.get("widget_id")
                    )
                    await db.commit()
                    payload = CommentResponse.model_validate(comment).model_dump(mode="json")
                await hub.broadcast(dashboard_id, {"type": "chat", "comment": payload})
            elif kind == "ping":
                await ws.send_json({"type": "pong"})
    except WebSocketDisconnect:
        pass
    except Exception as exc:  # noqa: BLE001 — never let a bad frame crash the socket
        _log.warning("ws_error", error=type(exc).__name__, detail=str(exc)[:200])
    finally:
        await hub.disconnect(dashboard_id, conn)


async def _resolve_user_access(ticket: str | None) -> str | None:
    """Return the user id whose mailbox this ticket opens, or None.

    Ticket-only and SELF-BOUND: the `room` claim must name the holder's own mailbox,
    so a ticket can never be aimed at somebody else's. It is also inert elsewhere —
    `user:{id}` has no chat-room grammar (`_parse_room` → None → `can_access_room`
    → False), and `assert_access_token` denies the `room` claim as a Bearer.
    """
    if not ticket:
        return None
    try:
        payload = decode_access_token(ticket)
    except Exception:  # noqa: BLE001 — a bad ticket simply isn't auth
        return None
    sub = payload.get("sub")
    if not sub or payload.get("room") != notify.user_room(sub):
        return None
    async with AsyncSessionLocal() as db:
        user = (await db.execute(select(User).where(User.id == sub))).scalar_one_or_none()
        return user.id if user and user.is_active else None


@router.websocket("/user")
async def user_ws(ws: WebSocket) -> None:
    """The caller's own unread mailbox: a snapshot, then one frame per message.

    RECEIVE-ONLY — there is no post path here at all, so this endpoint adds zero
    blast radius to `can_access_room`.

    NO PATH PARAM, deliberately. The mailbox is derived from the ticket's subject,
    so there is nothing for a client to enumerate. Do not "make it consistent" with
    the endpoints above by adding `/{user_id}`: dm_peers hands every caller a list
    of co-member ids, so a path param guarded only by a `usr`-style claim would be
    an instant full-mailbox IDOR.
    """
    ip = ws.client.host if ws.client else "unknown"
    if not check_ip("ws_connect", ip, limit=_IP_CONNECTS, window_seconds=60):
        await ws.close(code=4429)
        return
    user_id = await _resolve_user_access(ws.query_params.get("ticket"))
    if user_id is None:
        await ws.close(code=4401)
        return
    # Post-auth, per-USER cap. The IP bucket above is shared by everyone behind one
    # office NAT, so it can't be what bounds an app-lifetime socket — hitting it
    # would kill the badge for a whole team.
    if not check_ip("user_ws", user_id, limit=20, window_seconds=60):
        await ws.close(code=4429)
        return

    await ws.accept()
    room = notify.user_room(user_id)
    conn = Connection(
        ws=ws,
        participant=Participant(conn_id=uuid.uuid4().hex[:8], user_id=user_id, name="", color=""),
    )
    # Register BEFORE snapshotting. A message committed between the two is then
    # delivered by the socket and merged by message_id; the reverse order drops it
    # silently, because hub.broadcast returns early on a room with no connections.
    await hub.connect(room, conn, announce=False)
    try:
        async with AsyncSessionLocal() as db:
            rooms = await chat_service.unread_overview(db, user_id)
        await ws.send_json({"type": "unread_snapshot", "rooms": rooms})
        while True:
            try:
                msg = await ws.receive_json()
            except WebSocketDisconnect:
                raise
            except Exception:  # noqa: BLE001 — skip a malformed frame, keep the session
                continue
            # Keepalive only; every other frame is ignored on purpose.
            if msg.get("type") == "ping":
                await ws.send_json({"type": "pong"})
    except WebSocketDisconnect:
        pass
    except Exception as exc:  # noqa: BLE001 — never let a bad frame crash the socket
        _log.warning("ws_error", error=type(exc).__name__, detail=str(exc)[:200])
    finally:
        await hub.disconnect(room, conn, announce=False)


async def _resolve_room_access(
    room_key: str, ticket: str | None, token: str | None
) -> tuple[str, str] | None:
    """Return (user_id, display_name) for a team-chat room, or None.

    Members only — no share-token / guest path. A room ticket (preferred) is bound
    to this exact ``room_key``; a legacy JWT is accepted as a fallback. Either way
    the user must pass ``chat_service.can_access_room``.
    """
    async with AsyncSessionLocal() as db:
        for cred, scoped in ((ticket, True), (token, False)):
            if not cred:
                continue
            try:
                payload = decode_access_token(cred)
                if scoped:
                    if payload.get("room") != room_key:  # ticket bound to one room
                        continue
                else:
                    # Unscoped slot: a real access token only. A room ticket replayed
                    # here would unlock every room its holder can reach, not just the
                    # one it was minted for.
                    assert_access_token(payload)
            except Exception:  # noqa: BLE001 — bad cred just isn't valid auth
                continue
            user = (
                await db.execute(select(User).where(User.id == payload.get("sub")))
            ).scalar_one_or_none()
            if user and await chat_service.can_access_room(db, user.id, room_key):
                return user.id, (user.full_name or user.email)
        return None


@router.websocket("/room/{room_key}")
async def room_ws(ws: WebSocket, room_key: str) -> None:
    """Team-chat WebSocket for a workspace channel or a 1:1 DM room."""
    ip = ws.client.host if ws.client else "unknown"
    if not check_ip("ws_connect", ip, limit=_IP_CONNECTS, window_seconds=60):
        await ws.close(code=4429)
        return
    access = await _resolve_room_access(
        room_key, ws.query_params.get("ticket"), ws.query_params.get("token")
    )
    if access is None:
        await ws.close(code=4401)
        return

    await ws.accept()
    user_id, name = access
    conn_id = uuid.uuid4().hex[:8]
    color = _COLORS[hash(conn_id) % len(_COLORS)]
    conn = Connection(
        ws=ws, participant=Participant(conn_id=conn_id, user_id=user_id, name=name, color=color)
    )
    await hub.connect(room_key, conn)
    try:
        while True:
            try:
                msg = await ws.receive_json()
            except WebSocketDisconnect:
                raise
            except Exception:  # noqa: BLE001 — skip a malformed frame, keep the session
                continue
            kind = msg.get("type")
            if kind == "chat":
                text = (msg.get("text") or "").strip()
                if not text:
                    continue
                if not check_ip("ws_chat", ip, limit=20, window_seconds=10):
                    await ws.send_json({"type": "throttled"})
                    continue
                async with AsyncSessionLocal() as db:
                    message = await chat_service.post_message(db, room_key, user_id, name, text)
                    await db.commit()
                    # Persist before publishing so a member's history refetch can't
                    # miss it; publish_message also badges members who aren't here.
                    await notify.publish_message(db, message)
                # The assistant replies out-of-band so the user's post never waits on AI.
                if ai_chat_service.is_ai_trigger(room_key, text):
                    ai_chat_service.spawn_reply(room_key, user_id, text)
            elif kind == "typing":
                # Ephemeral — no DB, no persistence; peers age it out client-side.
                if check_ip("ws_typing", ip, limit=30, window_seconds=10):
                    await hub.broadcast(
                        room_key,
                        {"type": "typing", "user_id": user_id, "name": name},
                        exclude=conn,
                    )
            elif kind == "ping":
                await ws.send_json({"type": "pong"})
    except WebSocketDisconnect:
        pass
    except Exception as exc:  # noqa: BLE001 — never let a bad frame crash the socket
        _log.warning("ws_error", error=type(exc).__name__, detail=str(exc)[:200])
    finally:
        await hub.disconnect(room_key, conn)
