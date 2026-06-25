"""Billing request/response schemas."""
from __future__ import annotations

from pydantic import BaseModel


class PlanInfo(BaseModel):
    key: str
    name: str
    price_usd: int
    monthly_quota: int
    features: list[str]


class UsageResponse(BaseModel):
    tier: str
    tier_name: str
    used: int
    limit: int
    remaining: int
    period_start: str | None = None
    resets_at: str | None = None


class UpgradeRequest(BaseModel):
    tier: str
