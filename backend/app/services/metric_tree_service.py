"""Metric tree — KPI decomposition CRUD + bottom-up evaluation.

A node with no children is a leaf; an internal node combines its children with
its operator (add/sub/mul/div). Each child also gets a contribution % of its
parent's value. Pure arithmetic, no AI.

PROVENANCE. A leaf's number is either *measured* (aggregated from a saved
query's last stored run), *manual* (a float the user typed — an assumption), or
*unknown*. Two rules follow from that and everything else here is detail:

1. Nothing fabricates. A manual leaf with no value, and a query leaf whose
   binding cannot be resolved, are ``unknown`` — they are NOT 0.0. The old code
   collapsed both to 0.0, which reads as harmless under ``add`` and silently
   zeroes the entire product under ``mul``.
2. Unknown propagates. ``_combine`` returns None if any input is None, so an
   ancestor of an unknown leaf has value None, not a number computed from a
   guess. The UI renders that as "—" and the copilot is told not to state it.

The read path deliberately does NOT execute anything. evaluate() runs on every
copilot turn and every Twin page load; a measured leaf reads the rows already
stored on the saved query's last run (the same source alert_service evaluates
against, capped upstream at 1000 rows). So the number can be stale — which is
why measured_at travels with it — but reading the tree costs two SELECTs.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime
from math import prod
from typing import Any

from sqlalchemy import delete as sql_delete
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NexusBIException, SchemaNotFoundError
from app.core.timeutil import aware
from app.models.metric_node import AGGREGATIONS, SOURCE_QUERY, MetricNode
from app.models.query_log import QueryLog
from app.models.saved_query import SavedQuery

MAX_DEPTH = 12

# Provenance of a leaf's number.
MEASURED = "measured"
MANUAL = "manual"
UNKNOWN = "unknown"

# Why a leaf is unknown. These strings are a contract: the frontend maps each to
# an i18n key and the copilot repeats them back to the user, so renaming one is
# a breaking change in three places at once.
REASON_EMPTY = "empty"                    # manual leaf, nothing entered
REASON_BAD_BINDING = "bad_binding"        # query leaf missing query/column/agg
REASON_QUERY_MISSING = "query_missing"    # bound saved query no longer exists
REASON_NEVER_RUN = "never_run"            # bound query has not been run at all
REASON_RESULT_MISSING = "result_missing"  # it ran, but no stored result survives
REASON_NO_ROWS = "no_rows"                # last run returned zero rows
REASON_COLUMN_MISSING = "column_missing"  # column absent from the stored result
REASON_NOT_NUMERIC = "not_numeric"        # column present, nothing to aggregate


@dataclass(frozen=True)
class LeafValue:
    """A leaf's number together with where it came from."""

    value: float | None
    provenance: str
    source: str | None = None       # human-readable, e.g. "Aylıq satış / revenue (sum)"
    measured_at: datetime | None = None
    reason: str | None = None       # set iff provenance is UNKNOWN


async def list_nodes(db: AsyncSession, user_id: str) -> list[MetricNode]:
    res = await db.execute(
        select(MetricNode).where(MetricNode.user_id == user_id).order_by(MetricNode.position)
    )
    return list(res.scalars().all())


async def get(db: AsyncSession, user_id: str, node_id: str) -> MetricNode:
    res = await db.execute(
        select(MetricNode).where(MetricNode.id == node_id, MetricNode.user_id == user_id)
    )
    node = res.scalar_one_or_none()
    if node is None:
        raise SchemaNotFoundError("Düyün tapılmadı.")
    return node


async def _check_binding(db: AsyncSession, user_id: str, payload) -> None:
    """A query-bound leaf may only point at a saved query THIS user owns, and at
    a column that query actually returns.

    Owner-scoped lookup, so an id belonging to someone else 404s exactly like a
    made-up one — the same shape alert_service.create uses, and for the same
    reason: the difference between "not yours" and "does not exist" is itself a
    disclosure.

    The column check matters because the frontend is not the only caller: the
    copilot and any API client can post a typo, and the result is a leaf that
    reports `column_missing` forever while the form that created it looked
    complete. It is a check, not a guarantee — the query can be edited later, so
    `column_missing` stays a runtime state either way.
    """
    if getattr(payload, "source_kind", None) != SOURCE_QUERY:
        return
    sq_id = getattr(payload, "saved_query_id", None)
    if not sq_id:
        raise NexusBIException("Sorğuya bağlı leaf üçün saved_query_id tələb olunur.")
    res = await db.execute(
        select(SavedQuery).where(SavedQuery.id == sq_id, SavedQuery.user_id == user_id)
    )
    sq = res.scalar_one_or_none()
    if sq is None:
        raise SchemaNotFoundError("Saxlanan sorğu tapılmadı.")

    column = getattr(payload, "value_column", None)
    columns = await _stored_columns(db, user_id, sq.last_query_log_id)
    # No stored run means nothing to check against — binding to a query that has
    # not run yet is legitimate (it resolves to `never_run` until it does), so
    # this stays silent rather than inventing a rule the user cannot satisfy.
    if columns and column not in columns:
        raise NexusBIException(
            f"«{column}» sütunu bu sorğunun nəticəsində yoxdur. Mövcud sütunlar: "
            + ", ".join(columns)
        )


async def create(db: AsyncSession, user_id: str, payload) -> MetricNode:
    if payload.parent_id is not None:
        await get(db, user_id, payload.parent_id)  # ownership + existence
    await _check_binding(db, user_id, payload)
    node = MetricNode(
        user_id=user_id, parent_id=payload.parent_id, name=payload.name,
        operator=payload.operator, manual_value=payload.manual_value, position=payload.position,
        source_kind=payload.source_kind, saved_query_id=payload.saved_query_id,
        value_column=payload.value_column, agg=payload.agg,
    )
    db.add(node)
    await db.flush()
    await db.refresh(node)
    return node


async def update(db: AsyncSession, user_id: str, node_id: str, payload) -> MetricNode:
    node = await get(db, user_id, node_id)
    await _check_binding(db, user_id, payload)
    # Reparenting is intentionally NOT allowed here — keeps the tree acyclic by
    # construction (a node's parent is fixed at create time).
    sent = payload.model_dump(exclude_unset=True)
    for field in ("name", "operator", "position"):
        if sent.get(field) is not None:
            setattr(node, field, sent[field])
    if "manual_value" in sent:
        # An explicit null is meaningful here and must not be read as "field
        # omitted": clearing the number is how a leaf goes back to `unknown`,
        # which is the whole point of having that state. The loop above cannot
        # express it, which is why manual_value is handled separately.
        node.manual_value = sent["manual_value"]
    # The binding fields are set as a UNIT, and only when source_kind is sent.
    # Field-by-field "skip if None" would make switching a leaf back to manual
    # impossible: the caller sends saved_query_id=None to detach and the loop
    # above would read that as "not provided" and keep the stale binding, so a
    # manual leaf would still resolve against a query.
    if payload.source_kind is not None:
        node.source_kind = payload.source_kind
        if payload.source_kind == SOURCE_QUERY:
            node.saved_query_id = payload.saved_query_id
            node.value_column = payload.value_column
            node.agg = payload.agg
        else:
            node.saved_query_id = None
            node.value_column = None
            node.agg = None
    await db.flush()
    await db.refresh(node)
    return node


async def delete(db: AsyncSession, user_id: str, node_id: str) -> None:
    await get(db, user_id, node_id)  # ownership check
    # SQLite doesn't enforce ON DELETE CASCADE without PRAGMA, so collect the whole
    # subtree explicitly and delete it in one statement.
    nodes = await list_nodes(db, user_id)
    children: dict[str | None, list[str]] = {}
    for n in nodes:
        children.setdefault(n.parent_id, []).append(n.id)
    doomed: list[str] = []
    stack = [node_id]
    while stack:
        nid = stack.pop()
        doomed.append(nid)
        stack.extend(children.get(nid, []))
    await db.execute(
        sql_delete(MetricNode).where(MetricNode.id.in_(doomed), MetricNode.user_id == user_id)
    )
    await db.flush()


# ─── Leaf resolution ───

def _aggregate(rows: list[Any], column: str, agg: str) -> tuple[float | None, str | None]:
    """Reduce one column of a stored result set. Returns (value, unknown_reason).

    decision_service.extract_scalar does something similar and is deliberately
    NOT reused: when the requested column is absent it falls back to the first
    numeric column, which is the right call for a decision's headline metric and
    the wrong one here — a KPI leaf that quietly starts measuring a different
    column is precisely the mislabelling this module exists to prevent.
    """
    dict_rows = [r for r in rows if isinstance(r, dict)]
    if not dict_rows:
        return None, REASON_NO_ROWS
    # Presence is decided on the KEYS. A column that is NULL in every row does
    # exist; reporting "column_missing" there would send the user hunting for a
    # typo that isn't in their query.
    if not any(column in r for r in dict_rows):
        return None, REASON_COLUMN_MISSING
    present = [r.get(column) for r in dict_rows]
    if agg == "count":
        # count is about rows, not magnitudes, so a text column is countable.
        return float(sum(1 for v in present if v is not None)), None
    nums: list[float] = []
    for raw in present:
        # bool is an int in Python; summing True as 1 would turn a flag column
        # into a number that looks measured.
        if raw is None or isinstance(raw, bool):
            continue
        try:
            nums.append(float(raw))
        except (TypeError, ValueError):
            continue
    if not nums:
        return None, REASON_NOT_NUMERIC
    if agg == "sum":
        return float(sum(nums)), None
    if agg == "avg":
        return float(sum(nums) / len(nums)), None
    if agg == "min":
        return float(min(nums)), None
    if agg == "max":
        return float(max(nums)), None
    if agg == "last":
        # "Last" is the last row the engine returned — the saved query's own
        # ORDER BY is the only ordering available here, and this does not invent
        # one. A leaf that needs "latest by date" should say so in its query.
        return float(nums[-1]), None
    return None, REASON_BAD_BINDING


def resolve_leaf(
    node: MetricNode,
    queries: dict[str, SavedQuery],
    logs: dict[str, QueryLog],
) -> LeafValue:
    """Where this leaf's number comes from — the single place that decides."""
    if node.source_kind != SOURCE_QUERY:
        if node.manual_value is None:
            return LeafValue(None, UNKNOWN, reason=REASON_EMPTY)
        return LeafValue(float(node.manual_value), MANUAL)

    if not node.saved_query_id:
        # ON DELETE SET NULL blanks this when the bound saved query is deleted
        # (measured: db/session.py turns SQLite's foreign_keys PRAGMA on, so it
        # fires there too), and the schema refuses to create a query leaf without
        # one. So an empty id means the query is GONE, not that the user
        # misconfigured the leaf — reporting bad_binding here would send them to
        # fix a form that is already correct.
        return LeafValue(None, UNKNOWN, reason=REASON_QUERY_MISSING)
    if not node.value_column or node.agg not in AGGREGATIONS:
        return LeafValue(None, UNKNOWN, reason=REASON_BAD_BINDING)

    # `queries` only ever holds this user's saved queries, so a foreign id lands
    # here as "missing" rather than resolving. That is the ownership boundary of
    # the read path, and it does not lean on the FK: the constraint is absent on
    # a SQLite box upgraded through migration d7e8f9a0b1c2, so a dangling id is
    # reachable there.
    sq = queries.get(node.saved_query_id)
    if sq is None:
        return LeafValue(None, UNKNOWN, reason=REASON_QUERY_MISSING)

    source = f"{sq.name} / {node.value_column} ({node.agg})"
    if not sq.last_query_log_id:
        return LeafValue(None, UNKNOWN, source=source, reason=REASON_NEVER_RUN)
    log = logs.get(sq.last_query_log_id)
    rows = (log.result_data or {}).get("rows") if log is not None else None
    if not isinstance(rows, list):
        # The query HAS run, but that run stored no rows to read — result_data is
        # nullable and an RLS-denied or failed execution leaves it empty. Telling
        # the user "never run" here asks them to do something they already did,
        # and these strings are a contract in four locales and to the model.
        #
        # Measured: DELETING the log is NOT this case. The FK is ON DELETE SET
        # NULL and db/session.py turns SQLite's foreign_keys pragma on, so a
        # purged log blanks last_query_log_id and lands on `never_run` above.
        # This branch is for a live id whose row carries no result — including
        # one owned by someone else, which the user_id filter turns into a miss.
        return LeafValue(None, UNKNOWN, source=source, reason=REASON_RESULT_MISSING)

    # How old the DATA is, which is not the same question as when the run was
    # recorded. query_service persists a cache hit under a fresh log (rows up to
    # CACHE_TTL_SECONDS older than the run) and dashboard_service
    # .refresh_widget_data rewrites a shared log's rows in place without moving
    # any run stamp — the two err in opposite directions, so neither can be
    # papered over with a fudge factor. QueryLog.data_as_of records the fetch
    # itself; it is NULL only on rows written before that column existed, and
    # those fall back to the run stamp, which is what this line read before.
    measured_at = aware(log.data_as_of) or aware(sq.last_run_at)
    value, reason = _aggregate(rows, node.value_column, node.agg)
    if value is None:
        return LeafValue(None, UNKNOWN, source=source, measured_at=measured_at, reason=reason)
    return LeafValue(value, MEASURED, source=source, measured_at=measured_at)


def _columns_expr():
    """Just the column-NAME list out of a stored result, never the row snapshot.

    result_data is ``{"columns": [...], "rows": [...]}`` and the rows are capped
    at 1000 per query (query_service.snapshot_rows). Loading whole QueryLog rows
    to populate a dropdown deserialises megabytes of JSON to read a handful of
    strings — and the tree tab does it on every mount.
    """
    return QueryLog.result_data["columns"]


def _as_columns(raw: Any) -> list[str]:
    """Accept either dialect's shape for that JSON member.

    SQLite's JSON_EXTRACT returns a JSON *string* for an array; Postgres returns
    the parsed list. Betting on one is exactly the SQLite-vs-Postgres gap that
    makes a green unit suite and a broken deployment — so handle both.
    """
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except ValueError:
            return []
    return [str(c) for c in raw] if isinstance(raw, list) else []


async def _stored_columns(db: AsyncSession, user_id: str, log_id: str | None) -> list[str]:
    """Columns of one stored result, owner-scoped. Empty when there is no run."""
    if not log_id:
        return []
    res = await db.execute(
        select(_columns_expr()).where(QueryLog.id == log_id, QueryLog.user_id == user_id)
    )
    return _as_columns(res.scalar_one_or_none())


async def bindable_sources(db: AsyncSession, user_id: str) -> list[dict]:
    """Saved queries a leaf can be bound to, with the columns their last run has.

    Reads stored results only — the same non-executing path resolve_leaf uses. A
    picker that ran each query to list its columns would turn opening a dropdown
    into N warehouse queries.

    Queries with no stored run are omitted: binding to one produces a leaf that
    is `never_run` until someone happens to run it, which looks like a bug from
    the user's side of the form.
    """
    res = await db.execute(
        select(SavedQuery)
        .where(SavedQuery.user_id == user_id, SavedQuery.last_query_log_id.is_not(None))
        .order_by(SavedQuery.created_at.desc())
    )
    queries = list(res.scalars().all())
    log_ids = {sq.last_query_log_id for sq in queries if sq.last_query_log_id}
    if not log_ids:
        return []
    res = await db.execute(
        select(QueryLog.id, _columns_expr()).where(
            QueryLog.id.in_(log_ids), QueryLog.user_id == user_id
        )
    )
    columns_by_log = {log_id: _as_columns(raw) for log_id, raw in res.all()}

    out: list[dict] = []
    for sq in queries:
        columns = columns_by_log.get(sq.last_query_log_id or "") or []
        if not columns:
            continue
        out.append({
            "saved_query_id": sq.id,
            "name": sq.name,
            "columns": columns,
            "last_run_at": aware(sq.last_run_at),
        })
    return out


async def _resolve_all(db: AsyncSession, user_id: str, nodes: list[MetricNode]) -> dict[str, LeafValue]:
    """Resolve every node as if it were a leaf, in two batched SELECTs.

    Every node, not just the childless ones, because a node at MAX_DEPTH is
    evaluated as a leaf too — resolving on demand inside the recursion would
    reintroduce the N+1 this batching exists to avoid.
    """
    sq_ids = {n.saved_query_id for n in nodes if n.source_kind == SOURCE_QUERY and n.saved_query_id}
    queries: dict[str, SavedQuery] = {}
    logs: dict[str, QueryLog] = {}
    if sq_ids:
        res = await db.execute(
            select(SavedQuery).where(SavedQuery.id.in_(sq_ids), SavedQuery.user_id == user_id)
        )
        queries = {sq.id: sq for sq in res.scalars().all()}
        log_ids = {sq.last_query_log_id for sq in queries.values() if sq.last_query_log_id}
        if log_ids:
            res = await db.execute(
                select(QueryLog).where(QueryLog.id.in_(log_ids), QueryLog.user_id == user_id)
            )
            logs = {log.id: log for log in res.scalars().all()}
    return {n.id: resolve_leaf(n, queries, logs) for n in nodes}


# ─── Evaluation ───

def _combine(operator: str, values: list[float | None]) -> float | None:
    """Combine child values. Any unknown input makes the result unknown.

    The None check comes FIRST, before the operator is even looked at: the whole
    point is that an unknown leaf must not be silently read as 0. Under `add`
    that substitution merely understates the total; under `mul` it zeroes the
    KPI, and under `div` it can turn the result into 0 by way of the
    divide-by-zero guard below. All three would be reported as a number.
    """
    if any(v is None for v in values):
        return None
    known = [float(v) for v in values if v is not None]
    if not known:
        return 0.0
    if operator == "add":
        return float(sum(known))
    if operator == "sub":
        return float(known[0] - sum(known[1:]))
    if operator == "mul":
        return float(prod(known))
    if operator == "div":
        denom = prod(known[1:]) if len(known) > 1 else 1.0
        return float(known[0] / denom) if denom else 0.0
    raise NexusBIException(f"Naməlum operator: {operator}")


def _base_dict(node: MetricNode) -> dict:
    """The fields a node carries regardless of what it resolved to.

    Shared so that adding one is a single edit: spelled twice, a new field could
    land on leaves and not on branches, and EvaluatedNode's defaults would paper
    over the gap instead of rejecting it.
    """
    return {
        "id": node.id, "name": node.name, "operator": node.operator,
        "manual_value": node.manual_value,
        "source_kind": node.source_kind, "saved_query_id": node.saved_query_id,
        "value_column": node.value_column, "agg": node.agg,
    }


def _leaf_dict(node: MetricNode, lv: LeafValue) -> dict:
    return {
        **_base_dict(node),
        "value": lv.value,
        "provenance": lv.provenance, "source": lv.source, "measured_at": lv.measured_at,
        "unknown_reason": lv.reason, "incomplete": lv.provenance == UNKNOWN,
        "children": [],
    }


def _branch_dict(node: MetricNode, value: float | None, children: list[dict]) -> dict:
    return {
        **_base_dict(node),
        "value": value,
        # An internal node has no provenance of its own — it inherits its
        # trustworthiness from the leaves under it, which `incomplete` reports.
        "provenance": None, "source": None, "measured_at": None, "unknown_reason": None,
        "incomplete": any(c["incomplete"] for c in children),
        "children": children,
    }


def _eval(node: MetricNode, children: dict[str | None, list[MetricNode]],
          resolved: dict[str, LeafValue], depth: int) -> dict:
    kids = children.get(node.id, [])
    if not kids or depth >= MAX_DEPTH:
        return _leaf_dict(node, resolved[node.id])
    child_results = [_eval(k, children, resolved, depth + 1) for k in kids]
    value = _combine(node.operator, [c["value"] for c in child_results])
    # "Contribution %" (share of parent) is only meaningful for additive
    # composition; for ×/÷/− a child's value/parent ratio is unbounded/misleading,
    # so leave it None. It also needs both sides known — a share of an unknown
    # total is not a percentage.
    if node.operator == "add" and value:
        for c in child_results:
            if c["value"] is not None:
                c["contribution_pct"] = round(c["value"] / value * 100, 1)
    return _branch_dict(node, value, child_results)


async def evaluate(db: AsyncSession, user_id: str) -> list[dict]:
    """Return the evaluated forest (all root nodes) with values + contributions."""
    nodes = await list_nodes(db, user_id)
    resolved = await _resolve_all(db, user_id, nodes)
    children: dict[str | None, list[MetricNode]] = {}
    for n in nodes:
        children.setdefault(n.parent_id, []).append(n)
    roots = children.get(None, [])
    return [_eval(r, children, resolved, 0) for r in roots]


def collect_leaves(node: dict) -> list[dict]:
    """Every leaf under a node, in tree order."""
    kids = node.get("children") or []
    if not kids:
        return [node]
    return [leaf for k in kids for leaf in collect_leaves(k)]


def summarize(forest: list[dict]) -> dict:
    """Provenance roll-up over a whole forest — what the AI boundary must see.

    Counts alone would let the model say "one assumption" without naming it, so
    the leaf NAMES travel too: a warning the user cannot act on is barely better
    than no warning.
    """
    leaves = [leaf for root in forest for leaf in collect_leaves(root)]
    by = {MEASURED: [], MANUAL: [], UNKNOWN: []}
    for leaf in leaves:
        by.setdefault(leaf.get("provenance") or UNKNOWN, []).append(leaf["name"])
    return {
        "measured_leaves": by[MEASURED],
        "manual_leaves": by[MANUAL],
        "unknown_leaves": by[UNKNOWN],
        "fully_measured": bool(leaves) and not by[MANUAL] and not by[UNKNOWN],
        "has_unknown": bool(by[UNKNOWN]),
    }


# ─── Digital-twin simulation ───

def _simulate_node(
    node: dict, pct_by_name: dict[str, float], applied: set[str], matched: set[str]
) -> float | None:
    kids = node.get("children") or []
    if not kids:
        pct = pct_by_name.get(str(node.get("name") or "").strip().lower())
        # A name that hit a real leaf is MATCHED even when that leaf has no
        # value. Deciding this after the None check below would report the name
        # as unmatched — i.e. as a typo — for a leaf the very same response lists
        # under unknown_leaves, sending the user to fix a spelling that is right.
        if pct is not None:
            matched.add(node["name"])
        # The RESOLVED value, not manual_value: a measured leaf has no
        # manual_value at all, and reading that field would scale it from 0 and
        # report the scenario as if the lever did nothing.
        base = node.get("value")
        if base is None:
            return None
        if pct is not None:
            applied.add(node["name"])
            return float(base) * (1 + pct / 100)
        return float(base)
    return _combine(
        node["operator"], [_simulate_node(k, pct_by_name, applied, matched) for k in kids]
    )


def _round(value: float | None) -> float | None:
    return None if value is None else round(float(value), 2)


async def simulate(
    db: AsyncSession, user_id: str, changes: list[dict]
) -> dict:
    """Digital-twin scenario over the evaluated forest: scale leaves BY NAME
    (case-insensitive) by ±pct and re-roll every root with ``_combine`` — the
    single backend home of the twin value semantics (the frontend port in
    ``lib/metricTreeMath.ts`` mirrors it).

    A name matching several leaves applies to all of them; leaves below
    MAX_DEPTH are invisible to evaluate() and therefore unmatchable. A root with
    an unknown leaf under it simulates to None, not to a number — the scenario
    is genuinely unanswerable there.
    """
    pct_by_name: dict[str, float] = {}
    for c in changes:
        if isinstance(c, dict) and c.get("leaf_name") is not None and c.get("pct") is not None:
            try:
                pct_by_name[str(c["leaf_name"]).strip().lower()] = float(c["pct"])
            except (TypeError, ValueError):
                continue
    forest = await evaluate(db, user_id)
    applied: set[str] = set()
    matched: set[str] = set()
    results = [
        {
            "root": r["name"],
            "baseline": _round(r["value"]),
            "simulated": _round(_simulate_node(r, pct_by_name, applied, matched)),
            "incomplete": r["incomplete"],
        }
        for r in forest
    ]
    matched_lower = {m.lower() for m in matched}
    # Requested names that matched NO LEAF AT ALL — a misspelling. Keyed on
    # `matched`, not on `applied`: a leaf that exists but has no value is a
    # different problem, and it is already named in unknown_leaves. Renamed from
    # "unknown_leaves", which now means something else entirely — one key
    # carrying both senses is how a caller reports missing data as a typo.
    unmatched = sorted({name for name in pct_by_name if name not in matched_lower})
    return {
        "results": results,
        "applied": sorted(applied),
        "unmatched_leaves": unmatched,
        **summarize(forest),
    }
