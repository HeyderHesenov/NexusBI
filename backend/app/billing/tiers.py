"""Subscription tier catalogue — the single source of truth for quotas.

A quota unit is one model call, not one HTTP request, so a fan-out endpoint
costs what it actually spends. Numbers are set for roughly a 60% gross margin at
an estimated $0.01 per completion — an estimate that has never been measured, so
re-derive them from ai_spend_daily once real traffic exists.

Free plans smaller dashboards (3 questions rather than 6) so the same quota buys
twice as many of them.
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
    white_label: bool = False  # may set/serve custom branding on embeds
    ai_chat: bool = False  # Nexus AI assistant participates in team chat
    # Widgets an AI-generated dashboard plans for. Free gets a smaller board so
    # the same quota buys twice as many of them — and three focused widgets beat
    # six scattered ones as a first impression.
    dashboard_questions: int = 6


TIERS: dict[str, Tier] = {
    "free": Tier(
        key="free",
        name="Free",
        price_usd=0,
        monthly_quota=300,
        features=["Aylıq 300 AI sorğusu", "İnteraktiv dashboardlar", "CSV ixrac"],
        dashboard_questions=3,
    ),
    "pro": Tier(
        key="pro",
        name="Pro",
        price_usd=20,
        monthly_quota=800,
        features=["Aylıq 800 AI sorğusu", "Proqnoz & anomaliya", "White-label brending"],
        white_label=True,
    ),
    "max": Tier(
        key="max",
        name="Max",
        price_usd=100,
        monthly_quota=4000,
        features=[
            "Aylıq 4000 AI sorğusu (5x)",
            "Bütün Pro üstünlükləri",
            "Komanda söhbətində AI köməkçi",
            "Genişləndirilmiş tarixçə",
        ],
        white_label=True,
        ai_chat=True,
    ),
    "max_plus": Tier(
        key="max_plus",
        name="Max+",
        price_usd=150,
        monthly_quota=6000,
        features=[
            "Aylıq 6000 AI sorğusu",
            "Bütün Max üstünlükləri",
            "Komanda söhbətində AI köməkçi",
            "Ən yüksək limit",
        ],
        white_label=True,
        ai_chat=True,
    ),
    # Internal demo/test tier — unlimited usage, not shown as a purchasable plan.
    "unlimited": Tier(
        key="unlimited",
        name="Limitsiz",
        price_usd=0,
        monthly_quota=10**9,
        features=["Limitsiz AI sorğusu", "Bütün özəlliklər"],
        white_label=True,
        ai_chat=True,
    ),
}

#: Tiers offered for purchase on the pricing page (excludes internal "unlimited").
PURCHASABLE = ["free", "pro", "max", "max_plus"]


def is_unlimited(key: str | None) -> bool:
    return key == "unlimited"


def get_tier(key: str | None) -> Tier:
    """Return the tier for a key, falling back to Free for unknown values."""
    return TIERS.get(key or DEFAULT_TIER, TIERS[DEFAULT_TIER])


def has_white_label(key: str | None) -> bool:
    """True if the tier may set/serve custom white-label branding."""
    return get_tier(key).white_label


def questions_per_dashboard(key: str | None) -> int:
    """How many questions an AI dashboard plans for this tier."""
    return get_tier(key).dashboard_questions


def has_ai_chat(key: str | None) -> bool:
    """True if the tier may summon the Nexus AI assistant in team chat."""
    return get_tier(key).ai_chat
