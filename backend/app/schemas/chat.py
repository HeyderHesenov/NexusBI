"""Team chat schemas (channels, messages, DM peers)."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class ChannelCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class LastMessage(BaseModel):
    """Conversation-list preview: who said what last, and when."""

    author_id: str
    author_name: str
    content: str  # pre-truncated server-side for the rail snippet
    created_at: datetime


class ChannelResponse(BaseModel):
    id: str
    workspace_id: str
    name: str
    created_by: str
    created_at: datetime
    # Unread messages for the requesting user (0 when caught up).
    unread: int = 0
    last_message: LastMessage | None = None

    model_config = {"from_attributes": True}


class ChatMessageResponse(BaseModel):
    id: str
    room_key: str
    author_id: str
    author_name: str
    content: str
    created_at: datetime

    model_config = {"from_attributes": True}


class RoomRequest(BaseModel):
    room_key: str = Field(min_length=1, max_length=120)


class DMPeer(BaseModel):
    user_id: str
    email: str
    full_name: str | None = None
    unread: int = 0
    last_message: LastMessage | None = None
