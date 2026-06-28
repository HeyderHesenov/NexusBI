"""Proactive AI analyst — the "morning brief" (digest).

Scans a user's recent queries, surfaces the most notable changes (with a short
driver/reason), and rolls them into a SINGLE notification so the user opens the
app to "what you need to know" already prepared.

Design notes:
- Reuses ``insight_service.scan_recent_distinct`` (shared history scan) and
  ``insight_digest.summarize_change`` (AI, notable-or-null) per highlight.
- Falls back to a deterministic rule-based highlight so the brief still works
  offline / without an API key (same philosophy as the rest of the app).
- One brief = one Notification (title "🌅 Səhər brifi", body = bullet list).
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai import insight_digest
from app.config import settings
from app.core.logging import get_logger
from app.models.alert import Notification
from app.models.user import User
from app.services import insight_service

_log = get_logger("nexusbi.digest")
_TITLE = "🌅 Səhər brifi"


def _is_number(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _rule_based_highlight(rows: list[dict[str, Any]]) -> str | None:
    """Deterministic fallback: the leading row of the first numeric column.

    Keeps the brief useful when the AI digest is unavailable (offline/keyless).
    """
    if not rows:
        return None
    sample = rows[0]
    numeric_cols = [k for k, v in sample.items() if _is_number(v)]
    if not numeric_cols:
        return None
    value_col = numeric_cols[0]
    label_col = next((k for k in sample if k not in numeric_cols), None)

    def _val(row: dict[str, Any]) -> float:
        raw = row.get(value_col)
        return float(raw) if _is_number(raw) else float("-inf")

    top = max(rows, key=_val)
    top_val = _val(top)
    if top_val == float("-inf"):
        return None
    total = sum(v for v in (_val(r) for r in rows) if v != float("-inf"))
    # Only show a share when it's meaningful: positive leader within a positive
    # total (mixed-sign columns like profit/delta would yield absurd percentages).
    share = f" (payı ~{round(top_val / total * 100)}%)" if 0 < top_val <= total else ""
    display = top.get(value_col)
    if label_col is not None and top.get(label_col) is not None:
        return f"Lider: {top[label_col]} — {value_col} = {display}{share}."
    return f"Ən yüksək {value_col} = {display}{share}."


async def build_digest(
    db: AsyncSession, user_id: str, *, max_items: int | None = None
) -> Notification | None:
    """Build (and persist) a single brief notification for the user.

    Returns the Notification (caller flushes/commits) or None if nothing notable.
    """
    limit = max_items if max_items is not None else settings.DIGEST_MAX_ITEMS
    items: list[str] = []
    for nl, rows in await insight_service.scan_recent_distinct(db, user_id):
        if len(items) >= limit:
            break
        insight = await insight_digest.summarize_change(nl, [], rows)
        if not insight:
            insight = _rule_based_highlight(rows)
        if insight:
            items.append(f"• {nl[:70]} — {insight}")

    if not items:
        return None

    body = "Son sorğularının ən vacib nəticələri:\n" + "\n".join(items)
    notif = Notification(user_id=user_id, alert_id=None, title=_TITLE, body=body)
    db.add(notif)
    await db.flush()
    # Fan out to the user's workflow channels (Slack/Teams/email) — mock-first.
    from app.services import integration_service

    await integration_service.dispatch(db, user_id, _TITLE, body)
    return notif


def _start_of_day(now: datetime) -> datetime:
    return now.replace(hour=0, minute=0, second=0, microsecond=0)


async def run_digests_due(db: AsyncSession) -> int:
    """Scheduler hook: build today's brief for users who haven't received one.

    Runs once the clock has reached DIGEST_HOUR_UTC (``>=`` so a brief is still
    delivered if the server was down during that exact hour), and once-per-day
    per user via ``last_digest_at``. Stamps ``last_digest_at`` even when no brief
    is produced, so it never re-runs the same day. Returns the count created.
    """
    if not settings.DIGEST_ENABLED:
        return 0
    now = datetime.now(timezone.utc)
    if now.hour < settings.DIGEST_HOUR_UTC:
        return 0
    today = _start_of_day(now)
    res = await db.execute(
        select(User).where(
            User.is_active.is_(True),
            or_(User.last_digest_at.is_(None), User.last_digest_at < today),
        )
    )
    created = 0
    for user in res.scalars().all():
        try:
            notif = await build_digest(db, user.id)
        except Exception as exc:  # noqa: BLE001 — one user must not sink the batch
            _log.warning("digest_failed", user=user.id, error=str(exc)[:200])
            notif = None
        user.last_digest_at = now
        if notif is not None:
            created += 1
    if created:
        _log.info("digests_built", count=created)
    return created
