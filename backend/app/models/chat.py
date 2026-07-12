"""Team chat: workspace channels + 1:1 DMs.

Messages for both channels and DMs live in ONE table keyed by ``room_key`` (the
same arbitrary-string room the realtime hub broadcasts to). Channels are named
rooms scoped to a workspace; a DM room key encodes the sorted user-id pair, so no
separate membership table is needed for DMs.
"""
from __future__ import annotations

import uuid

from sqlalchemy import JSON, DateTime, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


def _uuid() -> str:
    return str(uuid.uuid4())


class Channel(Base, TimestampMixin):
    __tablename__ = "channels"
    __table_args__ = (UniqueConstraint("workspace_id", "name", name="uq_channel_name"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    workspace_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("workspaces.id", ondelete="CASCADE"), index=True, nullable=False
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    created_by: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )


class ChatMessage(Base, TimestampMixin):
    __tablename__ = "chat_messages"
    __table_args__ = (Index("ix_chat_messages_room_created", "room_key", "created_at"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    room_key: Mapped[str] = mapped_column(String(120), index=True, nullable=False)
    author_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    author_name: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    content: Mapped[str] = mapped_column(Text, nullable=False)
    # Structured payload written ONLY server-side (AI plan/actions cards); the
    # public post path never sets it, so `meta.ai` can't be spoofed by users.
    meta: Mapped[dict | None] = mapped_column(JSON, nullable=True)


class ChatReadMarker(Base, TimestampMixin):
    """Per-user, per-room "last read" watermark — powers unread counts cheaply."""

    __tablename__ = "chat_read_markers"
    __table_args__ = (UniqueConstraint("user_id", "room_key", name="uq_read_marker"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    room_key: Mapped[str] = mapped_column(String(120), nullable=False)
    last_read_at: Mapped[object] = mapped_column(DateTime(timezone=True), nullable=False)
