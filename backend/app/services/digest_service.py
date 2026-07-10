"""Proactive AI analyst — the "morning brief" (digest).

Scans a user's recent queries, surfaces the most notable changes (with a short
driver/reason), and rolls them into a SINGLE notification so the user opens the
app to "what you need to know" already prepared.

Design notes:
- Ranks candidates by NOTABILITY (each query's latest value vs its own history,
  a robust modified z-score) rather than recency, so the brief leads with what
  changed. Only the top-N get the (AI) ``insight_digest.summarize_change`` narration.
- Falls back to a deterministic rule-based highlight so the brief still works
  fully offline (same philosophy as the rest of the app).
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
from app.core.notification_types import NotificationCategory
from app.models.alert import Notification
from app.models.query_log import QueryLog
from app.models.user import User
from app.services import stats
from app.services.insight_service import rows_of

_log = get_logger("nexusbi.digest")
_TITLE = "🌅 Səhər brifi"
# How far back to scan for per-query history when scoring notability.
_HISTORY_WINDOW = 200
# A robust z needs a few prior points to mean anything; below this, score 0.0 so a
# first-ever run is never "notable" (nothing to compare it against).
_MIN_HISTORY = 3


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


def _scalar(rows: list[dict[str, Any]]) -> float | None:
    """A stable representative magnitude for a result set: the sum of its first
    numeric column. Used to compare a query against its own past snapshots."""
    if not rows:
        return None
    numeric_cols = [k for k, v in rows[0].items() if _is_number(v)]
    if not numeric_cols:
        return None
    col = numeric_cols[0]
    vals = [float(r[col]) for r in rows if _is_number(r.get(col))]
    return sum(vals) if vals else None


def _notability(scalars: list[float]) -> float:
    """How unusual the LATEST snapshot is vs this query's own history — the robust
    modified z-score of the last point. 0.0 without enough history (a first run
    has nothing to be notable against); a flat series scores 0 (MAD handles it)."""
    if len(scalars) < _MIN_HISTORY:
        return 0.0
    z = stats.modified_zscores(scalars)
    return abs(z[-1]) if z else 0.0


async def _recent_with_history(
    db: AsyncSession, user_id: str
) -> list[tuple[str, list[dict[str, Any]], list[float]]]:
    """Recent distinct queries as (nl, latest_rows, scalar_series). The scalar
    series is chronological (oldest→newest) so ``_notability`` scores the current
    value against prior runs of the SAME query. Newest-latest first (tie-break)."""
    res = await db.execute(
        select(QueryLog)
        .where(QueryLog.user_id == user_id, QueryLog.result_data.is_not(None))
        .order_by(QueryLog.created_at.desc())
        .limit(_HISTORY_WINDOW)
    )
    order: list[str] = []
    by_nl: dict[str, dict[str, Any]] = {}
    for log in res.scalars().all():  # newest first
        nl = (log.natural_language or "").strip()
        if not nl:
            continue
        key = nl.lower()
        rows = rows_of(log)
        if key not in by_nl:
            by_nl[key] = {"nl": nl, "latest_rows": rows, "history": []}
            order.append(key)
        else:  # an OLDER run of an already-seen query → history only
            sc = _scalar(rows)
            if sc is not None:
                by_nl[key]["history"].append(sc)  # newest-older→older; reversed below
    out = []
    for key in order:
        e = by_nl[key]
        if not e["latest_rows"]:  # skip queries whose newest run was empty
            continue
        # Score the value actually shown: current = _scalar(latest_rows) is always
        # the LAST element, so notability can never describe a stale snapshot even if
        # the newest run's rows became non-numeric.
        current = _scalar(e["latest_rows"])
        series = list(reversed(e["history"])) + [current] if current is not None else []
        out.append((e["nl"], e["latest_rows"], series))
    return out


async def build_digest(
    db: AsyncSession, user_id: str, *, max_items: int | None = None
) -> Notification | None:
    """Build (and persist) a single brief notification for the user.

    Ranks recent queries by NOTABILITY (how much the latest value deviates from
    the query's own history) rather than recency, so the brief leads with what
    actually changed. Notability is computed cheaply (no AI) for every candidate;
    only the top ``limit`` get the (AI) per-highlight narration.

    Returns the Notification (caller flushes/commits) or None if nothing notable.
    """
    limit = max_items if max_items is not None else settings.DIGEST_MAX_ITEMS
    scored = [
        (_notability(scalars), nl, rows)
        for nl, rows, scalars in await _recent_with_history(db, user_id)
    ]
    scored.sort(key=lambda s: s[0], reverse=True)  # stable → recency breaks 0.0 ties

    items: list[str] = []
    for _score, nl, rows in scored:
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
    notif = Notification(
        user_id=user_id, alert_id=None, title=_TITLE, body=body,
        category=NotificationCategory.DIGEST,
    )
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
