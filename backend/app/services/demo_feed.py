"""Synthetic live-data feed for the demo dataset.

The demo SQLite is reseeded on every query, so identical queries normally return
identical numbers. ``nudge`` random-walks per-category revenue multipliers so a
live dashboard's charts visibly move tick to tick — without touching any real
user datasource. Demo-only; bounded so values stay plausible.
"""
from __future__ import annotations

import random

from app.db import demo_data

_MIN_FACTOR = 0.55
_MAX_FACTOR = 1.75
_MAX_STEP = 0.14  # max change per category per tick


def nudge(rng: random.Random | None = None) -> dict[str, float]:
    """Random-walk the demo live multipliers within bounds; return the new set."""
    r = rng or random
    updated: dict[str, float] = {}
    for category, value in demo_data.current_live_factors().items():
        value += r.uniform(-_MAX_STEP, _MAX_STEP)
        value = max(_MIN_FACTOR, min(_MAX_FACTOR, value))
        updated[category] = round(value, 3)
    demo_data.set_live_factors(updated)
    return updated
