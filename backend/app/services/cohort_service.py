"""Cohort retention and funnel analytics over the demo events stream.

Each call runs its SELECT against one freshly seeded snapshot
(``execute_demo_snapshot``). Event counts never touch the live-feed revenue
multipliers, so the retention and funnel endpoints are deterministic and always
agree with each other even though they seed separately.
"""
from __future__ import annotations

from typing import Any

from app.core.exceptions import InvalidSQLError
from app.db.demo_data import FUNNEL_EVENT_STEPS, execute_demo_snapshot

_ACTIVITY_SQL = (
    "SELECT customer_id, substr(event_date, 1, 7) AS month"
    " FROM events GROUP BY customer_id, month"
)
_FUNNEL_SQL = (
    "SELECT event_type, COUNT(DISTINCT customer_id) AS customers"
    " FROM events GROUP BY event_type"
)


def _rows_or_raise(sql: str) -> list[dict[str, Any]]:
    """Run one demo SELECT; a failed query is an error, NOT an empty dataset."""
    (rows,) = execute_demo_snapshot([sql])
    if rows is None:
        raise InvalidSQLError("Kohort sorğusu icra olunmadı.")
    return rows


def _month_index(month: str) -> int:
    """'2024-03' → absolute month number (year*12 + month-1)."""
    year, mon = month.split("-")
    return int(year) * 12 + int(mon) - 1


def retention() -> dict[str, Any]:
    """Cohort retention matrix from the events stream.

    Cohort = the month of a customer's first event; a customer counts as
    retained at offset *k* if they have any event in cohort-month + k.
    Cells beyond the seeded calendar range are ``None`` (unknowable), inside
    the range but inactive are 0.
    """
    activity = _rows_or_raise(_ACTIVITY_SQL)

    label_of: dict[int, str] = {}
    months_by_customer: dict[Any, set[int]] = {}
    for row in activity:
        idx = _month_index(row["month"])
        label_of[idx] = row["month"]
        months_by_customer.setdefault(row["customer_id"], set()).add(idx)

    if not months_by_customer:
        return {"cohorts": [], "offsets": [], "sizes": [], "cells": []}

    last_month = max(label_of)
    members_by_cohort: dict[int, list[Any]] = {}
    for cid, months in months_by_customer.items():
        members_by_cohort.setdefault(min(months), []).append(cid)
    cohort_months = sorted(members_by_cohort)
    offsets = list(range(max(last_month - cm for cm in cohort_months) + 1))

    cells: list[list[dict[str, Any] | None]] = []
    for cm in cohort_months:
        members = members_by_cohort[cm]
        row_cells: list[dict[str, Any] | None] = []
        for k in offsets:
            if cm + k > last_month:
                row_cells.append(None)  # beyond the seeded calendar
                continue
            active = sum(1 for cid in members if cm + k in months_by_customer[cid])
            row_cells.append({"count": active, "pct": round(active / len(members) * 100, 1)})
        cells.append(row_cells)

    return {
        "cohorts": [label_of[cm] for cm in cohort_months],
        "offsets": offsets,
        "sizes": [len(members_by_cohort[cm]) for cm in cohort_months],
        "cells": cells,
    }


def funnel() -> dict[str, Any]:
    """Distinct customers per funnel step, with drop-off between steps."""
    rows = _rows_or_raise(_FUNNEL_SQL)
    counts = {row["event_type"]: row["customers"] for row in rows}

    steps: list[dict[str, Any]] = []
    first = counts.get(FUNNEL_EVENT_STEPS[0], 0)
    prev: int | None = None
    for name in FUNNEL_EVENT_STEPS:
        count = counts.get(name, 0)
        pct_of_first = round(count / first * 100, 1) if first else 0.0
        # A later step can't logically exceed its predecessor; clamp defensively
        # so odd data yields 0.0 instead of a negative "−-X%" label.
        drop_pct = round(max(prev - count, 0) / prev * 100, 1) if prev else 0.0
        steps.append(
            {
                "name": name,
                "count": count,
                "pct_of_first": pct_of_first,
                "drop_pct": drop_pct,
            }
        )
        prev = count
    return {"steps": steps}
