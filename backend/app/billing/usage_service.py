"""Monthly per-user usage accounting and rate-limit enforcement."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import case, or_, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.billing.tiers import get_tier, is_unlimited
from app.core.exceptions import RateLimitError
from app.core.logging import get_logger
from app.db.session import AsyncSessionLocal
from app.models.user import User

log = get_logger("nexusbi.usage")

PERIOD = timedelta(days=30)


def _aware(dt: datetime | None) -> datetime | None:
    """Normalise to timezone-aware UTC (SQLite returns naive datetimes)."""
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _window_elapsed(cutoff: datetime):
    """SQL predicate: this user's 30-day window has lapsed (or never started)."""
    return or_(User.usage_period_start.is_(None), User.usage_period_start <= cutoff)


async def check_and_consume(db: AsyncSession, user: User) -> None:
    """Reset the window if elapsed, enforce the tier quota, consume one call.

    One statement, not read-modify-write: two requests arriving together used to
    read the same count and write the same +1, so one of the two calls was free.
    The window reset rides along in CASE expressions, which see the column's
    pre-update value — exactly the "has it lapsed?" question being asked.
    """
    if is_unlimited(user.subscription_tier):
        return  # demo/test account — no counting, no limit
    now = datetime.now(timezone.utc)
    cutoff = now - PERIOD
    quota = get_tier(user.subscription_tier).monthly_quota
    elapsed = _window_elapsed(cutoff)
    result = await db.execute(
        update(User)
        .where(User.id == user.id, or_(elapsed, User.ai_calls_used + 1 <= quota))
        .values(
            usage_period_start=case((elapsed, now), else_=User.usage_period_start),
            ai_calls_used=case((elapsed, 1), else_=User.ai_calls_used + 1),
        )
        .execution_options(synchronize_session=False)
    )
    if result.rowcount == 0:
        raise RateLimitError(
            "Aylıq AI sorğu limitiniz doldu.",
            detail="Daha çox sorğu üçün planınızı yüksəldin.",
            code="ai_quota",
        )
    await db.flush()
    await db.refresh(user)


async def consume_extra(user_id: str, units: int) -> None:
    """Charge `units` more, unconditionally — those calls already cost money.

    Its own session on purpose: this runs after the endpoint returned, when the
    request's transaction may already be finished, and the charge must land
    whether or not the request itself succeeded.
    """
    if units <= 0:
        return
    try:
        async with AsyncSessionLocal() as session:
            await session.execute(
                update(User)
                .where(User.id == user_id)
                .values(ai_calls_used=User.ai_calls_used + units)
                .execution_options(synchronize_session=False)
            )
            await session.commit()
    except Exception as exc:  # noqa: BLE001 — never fail a response over accounting
        log.warning("quota_reconcile_failed", error=type(exc).__name__, detail=str(exc)[:200])


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
