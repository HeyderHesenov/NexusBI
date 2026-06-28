"""IntegrationChannel model — a Slack/Teams/email delivery target."""
from __future__ import annotations

import uuid

from sqlalchemy import Boolean, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


def _uuid() -> str:
    return str(uuid.uuid4())


class IntegrationChannel(Base, TimestampMixin):
    __tablename__ = "integration_channels"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    type: Mapped[str] = mapped_column(String(20), nullable=False)  # slack | teams | email
    name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    # Webhook URL or email address, Fernet-encrypted (may carry a secret token).
    target_encrypted: Mapped[str] = mapped_column(Text, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
