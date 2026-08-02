"""Row-level security (RLS) rules + post-fetch row filtering.

A datasource owner can restrict what a specific member sees: rows are kept only
where ``column == allowed_value`` (multiple values per column are OR-ed).

Filtering is applied AFTER fetch (in Python) — safe and injection-free. NOTE:
this constrains detail rows; pre-aggregated results (e.g. SUM grouped server-side)
are filtered only by the grouping columns that survive into the output.

``resolve_scope`` is the sentinel every read path must go through: a member with
no rule means "unrestricted" on an ``open`` source but "no rows at all" on a
``strict`` one, and a bare rule list cannot express that difference.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import SchemaNotFoundError
from app.models.datasource import RLS_STRICT, DataSource
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
    """Rules that constrain ``user_id`` on this datasource.

    An empty list on its own does NOT mean full access — on a ``strict`` source it
    means the opposite. Call ``resolve_scope`` instead of reading this directly.
    """
    res = await db.execute(
        select(RLSRule).where(
            RLSRule.datasource_id == datasource_id, RLSRule.member_id == user_id
        )
    )
    return list(res.scalars().all())


@dataclass(frozen=True)
class RLSScope:
    """What one viewer may read from one datasource.

    Three states, and the third is the whole point of this type: ``rules`` filter
    rows, ``deny_all`` removes every row, and both empty/false means unrestricted.
    A plain ``list[RLSRule]`` collapses the first and third into "empty".
    """

    rules: list[RLSRule]
    deny_all: bool

    @property
    def restricted(self) -> bool:
        """True when this viewer must NOT be served an owner-scoped snapshot."""
        return bool(self.rules) or self.deny_all


def scope_for(ds: DataSource, user_id: str, rules: list[RLSRule]) -> RLSScope:
    """Pure form of ``resolve_scope`` for callers that already loaded the rules.

    An EXPLICIT rule binds whoever it names — including the owner, who may write
    one against themselves. Only the IMPLICIT deny of ``strict`` mode exempts the
    owner: without that exemption, locking a source would lock its owner out of
    their own data and the feature would be unusable.
    """
    if rules:
        return RLSScope(rules, False)
    if ds.rls_mode == RLS_STRICT and ds.user_id != user_id:
        return RLSScope([], True)
    return RLSScope([], False)


async def resolve_scope(db: AsyncSession, ds: DataSource, user_id: str) -> RLSScope:
    """Row scope of ``user_id`` on an already-loaded datasource."""
    return scope_for(ds, user_id, await rules_for_user(db, ds.id, user_id))


async def resolve_scope_by_id(
    db: AsyncSession, datasource_id: str, user_id: str
) -> RLSScope:
    """``resolve_scope`` for callers holding only the id (loads the source).

    A missing datasource resolves to deny-all: we can't prove the viewer is
    allowed to see anything, so they see nothing.
    """
    ds = (
        await db.execute(select(DataSource).where(DataSource.id == datasource_id))
    ).scalar_one_or_none()
    if ds is None:
        return RLSScope([], True)
    return await resolve_scope(db, ds, user_id)


async def restricted_datasource_ids(
    db: AsyncSession, datasource_ids: set[str], viewer_ids: set[str] | None
) -> set[str]:
    """Which of these sources may NOT be served as one owner-scoped dataset.

    Every fan-out path — public share, embed, live broadcast — renders a single
    owner-executed (unfiltered) result for a whole audience, so the question is
    never "may this viewer read it?" but "could ANYONE in the audience be denied?".

    ``viewer_ids=None`` means the audience is unknown or anonymous: an anonymous
    viewer can never hold a rule, so anything strict — or carrying any rule at all
    — is excluded. That is the fail-closed default, and the only correct answer for
    a share token. A NAMED audience is resolved viewer by viewer through
    ``scope_for``, which is what lets a dashboard whose only watcher is its owner
    keep updating over a locked source.

    Two queries regardless of how many sources or viewers are involved: a source
    that fails to load is reported restricted (we cannot prove anyone may see it).
    """
    if not datasource_ids:
        return set()
    if viewer_ids is not None and not viewer_ids:
        # An empty audience is not "everyone is allowed" — it is an audience we
        # failed to enumerate. Treat it like an unknown one.
        viewer_ids = None

    rows = await db.execute(select(DataSource).where(DataSource.id.in_(datasource_ids)))
    sources = {ds.id: ds for ds in rows.scalars().all()}
    missing = datasource_ids - set(sources)

    if viewer_ids is None:
        rule_stmt = select(RLSRule.datasource_id).where(
            RLSRule.datasource_id.in_(datasource_ids)
        )
        ruled = set((await db.execute(rule_stmt)).scalars().all())
        return missing | {
            ds_id
            for ds_id, ds in sources.items()
            if ds.rls_mode == RLS_STRICT or ds_id in ruled
        }

    rule_rows = await db.execute(
        select(RLSRule).where(
            RLSRule.datasource_id.in_(datasource_ids), RLSRule.member_id.in_(viewer_ids)
        )
    )
    by_pair: dict[tuple[str, str], list[RLSRule]] = {}
    for rule in rule_rows.scalars().all():
        by_pair.setdefault((rule.datasource_id, rule.member_id), []).append(rule)

    return missing | {
        ds_id
        for ds_id, ds in sources.items()
        if any(
            scope_for(ds, viewer, by_pair.get((ds_id, viewer), [])).restricted
            for viewer in viewer_ids
        )
    }


def apply(rows: list[dict[str, Any]], rules: list[RLSRule]) -> list[dict[str, Any]]:
    """Keep only rows explicitly allowed by every constrained column.

    NOTE: the query pipeline now enforces RLS in the SQL itself (see
    ``rls_sql.constrain_sql``), which — unlike this post-fetch filter — is correct
    for server-side aggregates. This helper is retained for detail-row
    defense-in-depth and unit coverage only; it is not on the live query path.

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
