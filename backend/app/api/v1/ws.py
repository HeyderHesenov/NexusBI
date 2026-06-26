"""WebSocket endpoint for live dashboard collaboration (cursors + team chat)."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import select

from app.core.logging import get_logger
from app.core.security import decode_access_token
from app.db.session import AsyncSessionLocal
from app.models.dashboard import Dashboard
from app.models.user import User
from app.realtime.hub import Connection, Participant, hub
from app.schemas.comment import CommentResponse
from app.services import comment_service

router = APIRouter()
_log = get_logger("nexusbi.realtime")

_COLORS = ["#10B981", "#6366F1", "#F59E0B", "#EF4444", "#EC4899", "#14B8A6", "#8B5CF6", "#F97316"]
_guest_seq = 0


async def _resolve_access(
    dashboard_id: str, token: str | None, share: str | None
) -> tuple[str | None, str | None] | None:
    """Return (user_id, display_name) if access is granted, else None.

    Owner authenticates with a JWT (must own the dashboard); a share-link guest
    authenticates with the dashboard's share_token (user_id=None, name=None).
    """
    async with AsyncSessionLocal() as db:
        dash = (
            await db.execute(select(Dashboard).where(Dashboard.id == dashboard_id))
        ).scalar_one_or_none()
        if dash is None:
            return None
        # Try JWT first (owner). If it doesn't grant access, fall through to the
        # share token so a logged-in visitor can still join via a share link.
        if token:
            try:
                payload = decode_access_token(token)
                user = (
                    await db.execute(select(User).where(User.id == payload.get("sub")))
                ).scalar_one_or_none()
                if user and user.id == dash.user_id:
                    return user.id, (user.full_name or user.email)
            except Exception:  # noqa: BLE001 — bad token just isn't owner auth
                pass
        if share and dash.share_token and share == dash.share_token:
            return None, None  # guest via share link
        return None


@router.websocket("/dashboard/{dashboard_id}")
async def dashboard_ws(ws: WebSocket, dashboard_id: str) -> None:
    global _guest_seq
    access = await _resolve_access(
        dashboard_id, ws.query_params.get("token"), ws.query_params.get("share")
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
