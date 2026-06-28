"""Embed + white-label schemas."""
from __future__ import annotations

from pydantic import BaseModel, Field, field_validator

from app.schemas.dashboard import DashboardResponse


class EmbedToggle(BaseModel):
    enabled: bool = True


class EmbedResponse(BaseModel):
    embed_enabled: bool
    token: str | None = None


class BrandConfigUpdate(BaseModel):
    app_name: str | None = Field(default=None, max_length=120)
    # Strict #RRGGBB — the value is served unauthenticated to third-party embeds.
    primary_color: str | None = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")
    logo_url: str | None = Field(default=None, max_length=2000)

    @field_validator("logo_url")
    @classmethod
    def _safe_logo(cls, v: str | None) -> str | None:
        if v is None or v == "":
            return v
        if not v.startswith(("http://", "https://")):
            raise ValueError("logo_url http(s):// ilə başlamalıdır")
        return v


class BrandConfigResponse(BaseModel):
    app_name: str
    primary_color: str
    logo_url: str


class EmbeddedDashboard(BaseModel):
    dashboard: DashboardResponse
    brand: BrandConfigResponse
