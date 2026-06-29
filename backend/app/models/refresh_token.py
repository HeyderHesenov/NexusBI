"""Refresh-token records for rotation + server-side revocation."""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


def _uuid() -> str:
    return str(uuid.uuid4())


class RefreshToken(Base, TimestampMixin):
    """One issued refresh token. Rotation revokes the old row and writes a new one
    in the same ``family_id``; presenting an already-revoked jti means the token
    was stolen-and-replayed → the whole family is revoked (reuse detection)."""

    __tablename__ = "refresh_tokens"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    # The token's unique id (matches the "rt" JWT claim). Lookups are by jti.
    jti: Mapped[str] = mapped_column(String(36), unique=True, index=True, nullable=False)
    # All rotations of one login share a family so reuse can revoke the lineage.
    family_id: Mapped[str] = mapped_column(String(36), index=True, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
