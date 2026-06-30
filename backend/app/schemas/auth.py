"""Auth request/response schemas."""
from __future__ import annotations

from pydantic import BaseModel, EmailStr, Field, computed_field


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)
    full_name: str = Field(default="", max_length=255)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class GoogleAuthRequest(BaseModel):
    credential: str = Field(min_length=1)


class ProvidersResponse(BaseModel):
    google_enabled: bool
    google_client_id: str | None = None


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str | None = None
    token_type: str = "bearer"


class RefreshRequest(BaseModel):
    refresh_token: str = Field(min_length=1)


class UserResponse(BaseModel):
    id: str
    email: str
    full_name: str
    is_active: bool
    subscription_tier: str = "free"

    @computed_field  # derived server-side so the client never re-implements tier rules
    @property
    def white_label(self) -> bool:
        from app.billing.tiers import has_white_label

        return has_white_label(self.subscription_tier)
