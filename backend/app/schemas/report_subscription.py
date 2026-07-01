"""Report-subscription schemas (scheduled PDF/Excel email delivery)."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator


class SubscriptionCreate(BaseModel):
    recipient: str = Field(min_length=3, max_length=320)
    format: Literal["pdf", "xlsx"] = "pdf"
    schedule: Literal["hourly", "daily", "weekly"] = "daily"

    @field_validator("recipient")
    @classmethod
    def _valid_email(cls, v: str) -> str:
        v = v.strip()
        # Reject header-injection chars (CR/LF/comma/semicolon/space) BEFORE the
        # shape check so a value can never smuggle a Bcc:/CC: into the mail header.
        if any(c in v for c in "\r\n\t ,;") or "@" not in v or "." not in v.split("@")[-1]:
            raise ValueError("Düzgün email ünvanı deyil.")
        return v


class SubscriptionResponse(BaseModel):
    id: str
    saved_query_id: str
    recipient: str
    format: str
    schedule: str
    active: bool
    last_sent_at: str | None = None
