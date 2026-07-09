"""Deterministic display-format inference for chart configs — no AI, no DB.

Column NAMES tell us how a value should be rendered (percent vs count vs
money); they cannot tell us WHICH currency, so the ISO code comes from
``settings.DEFAULT_CURRENCY_CODE`` and money columns get no format when it is
unset — a wrong symbol is worse than none.

This module deliberately has no dependency on ``app.ai.types``: ChartConfig
applies these helpers in its own model validator, so EVERY construction site
(fresh AI selection, result cache, query history, dashboard snapshots) is
enriched — including rows persisted before this feature existed.
"""
from __future__ import annotations

import re

from app.config import settings

# Only names that explicitly say "percent" — rate/ratio/share are ambiguous
# (hourly_rate is money, market_share may be 0-1 scaled) and a wrong "%" is
# worse than none. Order matters: percent beats count beats money.
_PERCENT = re.compile(r"(^|_)(pct|percent|percentage)(_|$)", re.I)
_COUNT = re.compile(r"(^|_)(count|cnt|qty|quantity|num|units|orders)(_|$)", re.I)
_MONEY = re.compile(
    r"(^|_)(revenue|price|amount|cost|salary|profit|spend|spent|sales|income|budget)(_|$)",
    re.I,
)


def infer_format(column: str | None) -> dict | None:
    """Format hint for a value column as a plain dict, or None when unknown."""
    if not column:
        return None
    if _PERCENT.search(column):
        return {"unit": "%", "decimals": 1}
    if _COUNT.search(column):
        return {"decimals": 0}
    if _MONEY.search(column):
        code = settings.DEFAULT_CURRENCY_CODE.strip()
        return {"currency": code, "decimals": 2} if code else None
    return None


def humanize(column: str | None) -> str | None:
    """snake_case column → axis-label casing ("total_revenue" → "Total Revenue")."""
    if not column:
        return None
    return column.replace("_", " ").strip().title() or None
