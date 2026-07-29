"""The one place an in-app notification is born — and delivered.

Seven producers each hand-rolled ``db.add(Notification(...))``. That is why title
truncation drifted (only insight_service sliced to the column width; others built
unbounded f-strings into a String(255)), and why the bell could only ever be
polled. Folding creation here gives one place to respect the columns and one place
to push.

Delivery rides an ``after_commit`` hook rather than the call site: these producers
live in services whose transaction is owned by whoever called them (the scheduler,
a router, the WS loop), so no single call site knows when the row is durable — and
a frame sent before the commit lands races a client that refetches on it.
"""
from __future__ import annotations

import asyncio

from sqlalchemy import event, inspect
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session

from app.models.alert import Notification
from app.realtime.hub import hub, user_room

_TITLE_MAX = 255  # Notification.title is String(255)
_PENDING = "notify_pending"


async def create(
    db: AsyncSession,
    user_id: str,
    title: str,
    body: str,
    category: str,
    *,
    alert_id: str | None = None,
) -> Notification:
    """Persist a notification; deliver it to the owner's mailbox once committed."""
    row = Notification(
        user_id=user_id,
        alert_id=alert_id,
        title=title.strip()[:_TITLE_MAX],
        body=body,
        category=category,
    )
    db.add(row)
    await db.flush()  # populates id + created_at (server_default)
    # The frame is built NOW, while every attribute is loaded, so the sync
    # after_commit callback never touches the ORM and can't trigger a lazy load.
    db.sync_session.info.setdefault(_PENDING, []).append(
        (
            row,
            user_id,
            {
                "type": "notification",
                "id": row.id,
                "title": row.title,
                "body": row.body,
                "category": row.category,
                "alert_id": row.alert_id,
                "read": False,
                "created_at": row.created_at.isoformat(),
            },
        )
    )
    return row


@event.listens_for(Session, "after_commit")
def _deliver(session: Session) -> None:
    pending = session.info.pop(_PENDING, None)
    if not pending:
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return  # a sync session (scripts/migrations) — nobody is listening anyway
    for row, user_id, frame in pending:
        # Ask the row itself whether it survived, rather than trusting a rollback
        # hook. Neither after_rollback nor after_soft_rollback can be used here:
        # BOTH also fire when a SAVEPOINT unwinds, and mark_read's upsert relies on
        # one — so a discard-on-rollback listener silently eats notifications
        # queued earlier in the very same transaction. A rolled-back INSERT leaves
        # its object non-persistent; a savepoint unwind elsewhere does not.
        if not inspect(row).persistent:
            continue
        # Fire-and-forget: a dead socket must never fail a transaction that already
        # committed. hub.broadcast is a no-op when nobody is connected.
        loop.create_task(hub.broadcast(user_room(user_id), frame))
