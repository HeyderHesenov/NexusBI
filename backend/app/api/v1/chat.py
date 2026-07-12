"""Team chat HTTP endpoints: channels, history, room tickets, read markers, DM peers."""
from __future__ import annotations

from fastapi import APIRouter, Response, status

from app.core.exceptions import SchemaNotFoundError
from app.core.security import create_room_ticket
from app.dependencies import CurrentUser, DbDep
from app.schemas.chat import (
    ChannelCreate,
    ChannelResponse,
    ChatMessageResponse,
    DMPeer,
    RoomRequest,
)
from app.services import audit_service, chat_service

router = APIRouter(tags=["chat"])


@router.get("/workspaces/{workspace_id}/channels", response_model=list[ChannelResponse])
async def list_channels(
    workspace_id: str, user: CurrentUser, db: DbDep
) -> list[ChannelResponse]:
    channels = await chat_service.list_channels(db, workspace_id, user.id)
    unread = await chat_service.unread_counts(db, workspace_id, user.id)
    return [
        ChannelResponse(
            id=c.id, workspace_id=c.workspace_id, name=c.name, created_by=c.created_by,
            created_at=c.created_at,
            unread=unread.get(chat_service.channel_room(workspace_id, c.id), 0),
        )
        for c in channels
    ]


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
    return [DMPeer(user_id=p.id, email=p.email, full_name=p.full_name) for p in peers]
