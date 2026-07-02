"""Monthly per-user usage accounting and rate-limit enforcement."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.billing.tiers import get_tier, is_unlimited
from app.core.exceptions import RateLimitError
from app.models.user import User

PERIOD = timedelta(days=30)


def _aware(dt: datetime | None) -> datetime | None:
    """Normalise to timezone-aware UTC (SQLite returns naive datetimes)."""
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _reset_if_expired(user: User, now: datetime) -> None:
    start = _aware(user.usage_period_start)
    if start is None or now - start >= PERIOD:
        user.usage_period_start = now
        user.ai_calls_used = 0


async def check_and_consume(db: AsyncSession, user: User) -> None:
    """Reset the window if elapsed, enforce the tier quota, then consume one call."""
    if is_unlimited(user.subscription_tier):
        return  # demo/test account — no counting, no limit
    now = datetime.now(timezone.utc)
    _reset_if_expired(user, now)
    quota = get_tier(user.subscription_tier).monthly_quota
    if user.ai_calls_used >= quota:
        raise RateLimitError(
            "Aylıq AI sorğu limitiniz doldu.",
            detail="Daha çox sorğu üçün planınızı yüksəldin.",
            code="ai_quota",
        )
    user.ai_calls_used += 1
    await db.flush()


def get_usage(user: User) -> dict[str, Any]:
    """Snapshot the user's current quota state (no mutation)."""
    tier = get_tier(user.subscription_tier)
    if is_unlimited(user.subscription_tier):
        # Sentinel limit = -1 tells the frontend to render "unlimited".
        return {
            "tier": tier.key,
            "tier_name": tier.name,
            "used": 0,
            "limit": -1,
            "remaining": -1,
            "period_start": None,
            "resets_at": None,
        }
    start = _aware(user.usage_period_start)
    used = user.ai_calls_used
    if start is None or datetime.now(timezone.utc) - start >= PERIOD:
        used = 0  # window has lapsed; effective usage is zero until next call
    resets_at = (start + PERIOD).isoformat() if start else None
    return {
        "tier": tier.key,
        "tier_name": tier.name,
        "used": used,
        "limit": tier.monthly_quota,
        "remaining": max(0, tier.monthly_quota - used),
        "period_start": start.isoformat() if start else None,
        "resets_at": resets_at,
    }
