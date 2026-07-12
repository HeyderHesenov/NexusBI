"""Team chat schemas (channels, messages, DM peers, AI assistant actions)."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

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
    # Server-written AI payload (plan/actions cards); None for human messages.
    meta: dict[str, Any] | None = None

    model_config = {"from_attributes": True}


class RoomRequest(BaseModel):
    room_key: str = Field(min_length=1, max_length=120)


class AiActionRequest(BaseModel):
    message_id: str = Field(min_length=1, max_length=36)


ShareResourceType = Literal[
    "query_log",
    "dashboard",
    "saved_query",
    "ml_model",
    "ba_artifact",
    "decision",
    "contract",
    "metric",
]


class ShareRequest(BaseModel):
    """Share one of YOUR artifacts into a room you can access, as a rich card."""

    room_key: str = Field(min_length=1, max_length=120)
    resource_type: ShareResourceType
    resource_id: str = Field(min_length=1, max_length=36)
    caption: str = Field(default="", max_length=500)


class DMPeer(BaseModel):
    user_id: str
    email: str
    full_name: str | None = None
    unread: int = 0
    last_message: LastMessage | None = None
