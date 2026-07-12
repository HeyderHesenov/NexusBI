"""Team chat HTTP endpoints: channels, history, room tickets, read markers, DM peers."""
from __future__ import annotations

from fastapi import APIRouter, Response, status

from app.core.exceptions import SchemaNotFoundError
from app.core.security import create_room_ticket
from app.dependencies import CurrentUser, DbDep
from app.models.chat import ChatMessage
from app.schemas.chat import (
    ChannelCreate,
    ChannelResponse,
    ChatMessageResponse,
    DMPeer,
    LastMessage,
    RoomRequest,
)
from app.services import audit_service, chat_service

router = APIRouter(tags=["chat"])

_SNIPPET_LEN = 140


def _preview(msg: ChatMessage | None) -> LastMessage | None:
    if msg is None:
        return None
    return LastMessage(
        author_id=msg.author_id, author_name=msg.author_name,
        content=msg.content[:_SNIPPET_LEN], created_at=msg.created_at,
    )


@router.get("/workspaces/{workspace_id}/channels", response_model=list[ChannelResponse])
async def list_channels(
    workspace_id: str, user: CurrentUser, db: DbDep
) -> list[ChannelResponse]:
    channels = await chat_service.list_channels(db, workspace_id, user.id)
    rooms = {c.id: chat_service.channel_room(workspace_id, c.id) for c in channels}
    summaries = await chat_service.room_summaries(db, user.id, list(rooms.values()))
    out = []
    for c in channels:
        last, unread = summaries.get(rooms[c.id], (None, 0))
        out.append(
            ChannelResponse(
                id=c.id, workspace_id=c.workspace_id, name=c.name, created_by=c.created_by,
                created_at=c.created_at, unread=unread, last_message=_preview(last),
            )
        )
    # Most recently active first (channel creation counts as activity).
    out.sort(
        key=lambda c: c.last_message.created_at if c.last_message else c.created_at,
        reverse=True,
    )
    return out


@router.post(
    "/workspaces/{workspace_id}/channels",
    response_model=ChannelResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_channel(
    workspace_id: str, payload: ChannelCreate, user: CurrentUser, db: DbDep
) -> ChannelResponse:
    channel = await chat_service.create_channel(db, workspace_id, user.id, payload.name)
    await audit_service.log(
        db, user.id, "chat.channel_create", entity="workspace", entity_id=workspace_id,
        meta={"channel": channel.id, "name": channel.name},
    )
    return ChannelResponse.model_validate(channel)


@router.get("/chat/history", response_model=list[ChatMessageResponse])
async def history(room_key: str, user: CurrentUser, db: DbDep) -> list[ChatMessageResponse]:
    messages = await chat_service.history(db, room_key, user.id)
    return [ChatMessageResponse.model_validate(m) for m in messages]


@router.post("/chat/ticket")
async def room_ticket(payload: RoomRequest, user: CurrentUser, db: DbDep) -> dict[str, str]:
    """Mint a short-lived WS ticket for a room the caller can access."""
    if not await chat_service.can_access_room(db, user.id, payload.room_key):
        raise SchemaNotFoundError("Otağa giriş yoxdur.")
    return {"ticket": create_room_ticket(user.id, payload.room_key)}


@router.post("/chat/read", status_code=status.HTTP_204_NO_CONTENT)
async def mark_read(payload: RoomRequest, user: CurrentUser, db: DbDep) -> Response:
    await chat_service.mark_read(db, user.id, payload.room_key)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/chat/dm/peers", response_model=list[DMPeer])
async def dm_peers(user: CurrentUser, db: DbDep) -> list[DMPeer]:
    peers = await chat_service.dm_peers(db, user.id)
    rooms = {p.id: chat_service.dm_room(user.id, p.id) for p in peers}
    summaries = await chat_service.room_summaries(db, user.id, list(rooms.values()))
    out = []
    for p in peers:
        last, unread = summaries.get(rooms[p.id], (None, 0))
        out.append(
            DMPeer(
                user_id=p.id, email=p.email, full_name=p.full_name,
                unread=unread, last_message=_preview(last),
            )
        )
    # Active conversations first (newest activity), quiet peers after, alphabetical.
    out.sort(
        key=lambda p: (
            p.last_message is None,
            -(p.last_message.created_at.timestamp() if p.last_message else 0),
            (p.full_name or p.email).lower(),
        )
    )
    return out
