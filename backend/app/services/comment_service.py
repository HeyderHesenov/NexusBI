"""Dashboard comment (team chat) persistence."""
from __future__ import annotations

import re

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.alert import Notification
from app.models.comment import DashboardComment
from app.models.dashboard import Widget
from app.models.user import User

_MENTION_RE = re.compile(r"@([\w.+-]+@[\w.-]+|\w[\w.\-]{1,})")


_MAX_MENTIONS = 5


async def _notify_mentions(
    db: AsyncSession, content: str, author_id: str | None, author_name: str
) -> None:
    """Create an IN-APP notification for @mentioned users (by email or full name).

    Hardened (pentest): only authenticated authors may mention (guests blocked);
    capped to a few mentions per comment; and we deliberately DO NOT fan out to the
    mentioned user's outbound channels (Slack/Teams/email) — that would let one
    user push attacker-controlled text into another tenant's real inboxes. Outbound
    delivery stays reserved for the owner's own events (digests/alerts).
    """
    if author_id is None:
        return
    tokens = list({t.lower() for t in _MENTION_RE.findall(content)})[:_MAX_MENTIONS]
    if not tokens:
        return
    res = await db.execute(
        select(User).where(
            or_(func.lower(User.email).in_(tokens), func.lower(User.full_name).in_(tokens))
        )
    )
    for user in res.scalars().all():
        if user.id == author_id:
            continue  # don't notify yourself
        db.add(
            Notification(
                user_id=user.id,
                alert_id=None,
                title="Səni qeyd etdilər",
                body=f"{author_name}: {content[:200]}",
            )
        )
    await db.flush()


async def list_for_dashboard(
    db: AsyncSession, dashboard_id: str, limit: int = 200
) -> list[DashboardComment]:
    result = await db.execute(
        select(DashboardComment)
        .where(DashboardComment.dashboard_id == dashboard_id)
        .order_by(DashboardComment.created_at.asc())
        .limit(limit)
    )
    return list(result.scalars().all())


async def create(
    db: AsyncSession,
    dashboard_id: str,
    author_id: str | None,
    author_name: str,
    content: str,
    widget_id: str | None = None,
) -> DashboardComment:
    # Only attach widget_id if it belongs to this dashboard — a share-link guest
    # must not be able to reference another dashboard's widget.
    if widget_id:
        owned = await db.execute(
            select(Widget.id).where(
                Widget.id == widget_id, Widget.dashboard_id == dashboard_id
            )
        )
        if owned.scalar_one_or_none() is None:
            widget_id = None
    comment = DashboardComment(
        dashboard_id=dashboard_id,
        author_id=author_id,
        author_name=author_name[:120] or "Anonim",
        content=content[:2000],
        widget_id=widget_id,
    )
    db.add(comment)
    await db.flush()
    await db.refresh(comment)
    await _notify_mentions(db, content, author_id, comment.author_name)
    return comment
