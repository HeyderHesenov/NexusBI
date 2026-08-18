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
    # Which upgrade path the client should offer. Sent with usage because the
    # pricing page already fetches it and must decide before rendering.
    payments_enabled: bool = False
    # An ACTIVE subscription (plan changes go through the portal) versus merely
    # having paid once (the portal itself stays reachable, since a customer
    # outlives their subscription).
    has_subscription: bool = False
    has_billing_account: bool = False


class UpgradeRequest(BaseModel):
    tier: str
