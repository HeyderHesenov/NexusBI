"""Subscription tier catalogue — the single source of truth for quotas.

Monthly AI-query quotas. The $100 plan grants 5x the $20 plan; the $150 plan
grants 10x. Every AI endpoint (ask, retry, forecast, anomalies) consumes quota.
"""
from __future__ import annotations

from dataclasses import dataclass, field

DEFAULT_TIER = "free"


@dataclass(frozen=True)
class Tier:
    key: str
    name: str
    price_usd: int
    monthly_quota: int
    features: list[str] = field(default_factory=list)


TIERS: dict[str, Tier] = {
    "free": Tier(
        key="free",
        name="Free",
        price_usd=0,
        monthly_quota=30,
        features=["Aylıq 30 AI sorğusu", "İnteraktiv dashboardlar", "CSV ixrac"],
    ),
    "pro": Tier(
        key="pro",
        name="Pro",
        price_usd=20,
        monthly_quota=300,
        features=["Aylıq 300 AI sorğusu", "Proqnoz & anomaliya", "Prioritet emal"],
    ),
    "max": Tier(
        key="max",
        name="Max",
        price_usd=100,
        monthly_quota=1500,
        features=["Aylıq 1500 AI sorğusu (5x)", "Bütün Pro üstünlükləri", "Genişləndirilmiş tarixçə"],
    ),
    "max_plus": Tier(
        key="max_plus",
        name="Max+",
        price_usd=150,
        monthly_quota=3000,
        features=["Aylıq 3000 AI sorğusu (10x)", "Bütün Max üstünlükləri", "Ən yüksək limit"],
    ),
    # Internal demo/test tier — unlimited usage, not shown as a purchasable plan.
    "unlimited": Tier(
        key="unlimited",
        name="Limitsiz",
        price_usd=0,
        monthly_quota=10**9,
        features=["Limitsiz AI sorğusu", "Bütün özəlliklər"],
    ),
}

#: Tiers offered for purchase on the pricing page (excludes internal "unlimited").
PURCHASABLE = ["free", "pro", "max", "max_plus"]


def is_unlimited(key: str | None) -> bool:
    return key == "unlimited"


def get_tier(key: str | None) -> Tier:
    """Return the tier for a key, falling back to Free for unknown values."""
    return TIERS.get(key or DEFAULT_TIER, TIERS[DEFAULT_TIER])


def monthly_quota(key: str | None) -> int:
    return get_tier(key).monthly_quota
