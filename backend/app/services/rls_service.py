"""Row-level security (RLS) rules + post-fetch row filtering.

A datasource owner can restrict what a specific member sees: rows are kept only
where ``column == allowed_value`` (multiple values per column are OR-ed).

Filtering is applied AFTER fetch (in Python) — safe and injection-free. NOTE:
this constrains detail rows; pre-aggregated results (e.g. SUM grouped server-side)
are filtered only by the grouping columns that survive into the output.
"""
from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import SchemaNotFoundError
from app.models.workspace import RLSRule
from app.services import datasource_service


async def create_rule(
    db: AsyncSession,
    owner_id: str,
    datasource_id: str,
    member_id: str,
    column: str,
    allowed_value: str,
) -> RLSRule:
    # Only the datasource owner can define rules on it.
    await datasource_service.get_datasource(db, owner_id, datasource_id)
    rule = RLSRule(
        datasource_id=datasource_id,
        owner_id=owner_id,
        member_id=member_id,
        column=column,
        allowed_value=allowed_value,
    )
    db.add(rule)
    await db.flush()
    await db.refresh(rule)
    return rule


async def list_for_datasource(
    db: AsyncSession, owner_id: str, datasource_id: str
) -> list[RLSRule]:
    await datasource_service.get_datasource(db, owner_id, datasource_id)
    res = await db.execute(
        select(RLSRule)
        .where(RLSRule.datasource_id == datasource_id, RLSRule.owner_id == owner_id)
        .order_by(RLSRule.created_at.desc())
    )
    return list(res.scalars().all())


async def delete_rule(db: AsyncSession, owner_id: str, rule_id: str) -> None:
    rule = (
        await db.execute(
            select(RLSRule).where(RLSRule.id == rule_id, RLSRule.owner_id == owner_id)
        )
    ).scalar_one_or_none()
    if rule is None:
        raise SchemaNotFoundError("RLS qaydası tapılmadı.")
    await db.delete(rule)
    await db.flush()


async def rules_for_user(
    db: AsyncSession, datasource_id: str, user_id: str
) -> list[RLSRule]:
    """Rules that constrain ``user_id`` on this datasource (empty = full access)."""
    res = await db.execute(
        select(RLSRule).where(
            RLSRule.datasource_id == datasource_id, RLSRule.member_id == user_id
        )
    )
    return list(res.scalars().all())


def apply(rows: list[dict[str, Any]], rules: list[RLSRule]) -> list[dict[str, Any]]:
    """Keep only rows explicitly allowed by every constrained column.

    Fail-CLOSED: if a constrained column is absent from a row (e.g. the query
    aggregated it away or renamed it), the row is dropped — a restricted user
    can't see data we can't verify against the rule.
    """
    if not rules:
        return rows
    allowed: dict[str, set[str]] = {}
    for r in rules:
        allowed.setdefault(r.column, set()).add(r.allowed_value)
    out: list[dict[str, Any]] = []
    for row in rows:
        if all(col in row and str(row[col]) in values for col, values in allowed.items()):
            out.append(row)
    return out
