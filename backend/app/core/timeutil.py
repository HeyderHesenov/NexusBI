"""Timezone normalisation for stored datetimes.

SQLite hands back naive datetimes even for a ``DateTime(timezone=True)`` column,
so ``now - stored`` raises ``TypeError`` on one backend and works on the other --
a bug that only shows up in the deployment you did not test. Every "has enough
time passed?" site therefore normalises first.

That one-liner had been copy-pasted into five modules (saved_query,
report_delivery, scenario, decision, usage) before it lived here. It sits in
``core`` for the same reason ``sql_ident.quote_ident`` does: a billing helper
should not have to import a service to make a datetime comparable.
"""
from __future__ import annotations

from datetime import datetime, timezone


def aware(dt: datetime | None) -> datetime | None:
    """Normalise to timezone-aware UTC, passing ``None`` through."""
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
