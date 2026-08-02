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

from datetime import date, datetime, time, timezone

# Substrings that mark a column as a time axis (incl. az "tarix" = date). A NAME
# hint only: it is deliberately loose (it also matches "delivery_time" and, via
# "date", "update_count"), so anything that acts on the answer must check the
# values too.
TEMPORAL_HINTS = ("date", "time", "year", "month", "day", "_at", "tarix")


def aware(dt: datetime | None) -> datetime | None:
    """Normalise to timezone-aware UTC, passing ``None`` through.

    Attaches UTC to a naive value; it does not CONVERT an offset-carrying one.
    Comparing instants means going further — see `to_instant`.
    """
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def is_temporal(col: str) -> bool:
    """Name-based "could this column be a time axis?" test."""
    c = col.lower()
    return any(h in c for h in TEMPORAL_HINTS)


def to_instant(value: object) -> datetime | None:
    """Coerce a stored time value to a comparable UTC instant, else ``None``.

    One return type, always aware and always UTC, so a column mixing the shapes a
    driver can produce (aware datetime, naive datetime, date, ISO string) still
    sorts chronologically and can never raise the naive-vs-aware TypeError.

    Deliberately narrow. Numbers are rejected even though a year or an epoch would
    "work": the caller picks the column by a loose name match, and accepting
    numbers would make ``delivery_time`` or ``days_open`` a valid time axis. A
    non-ISO string ("01/05/2026") is rejected for the same reason — guessing its
    field order would mis-order it silently.
    """
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, datetime):
        return aware(value).astimezone(timezone.utc)  # type: ignore[union-attr]
    if isinstance(value, date):
        return datetime.combine(value, time.min, tzinfo=timezone.utc)
    if isinstance(value, str):
        text = value.strip()
        if text.endswith(("Z", "z")):
            text = text[:-1] + "+00:00"  # fromisoformat rejects Z before 3.11
        try:
            return aware(datetime.fromisoformat(text)).astimezone(timezone.utc)  # type: ignore[union-attr]
        except ValueError:
            return None
    return None
