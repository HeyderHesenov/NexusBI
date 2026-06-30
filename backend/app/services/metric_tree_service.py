"""Metric tree — KPI decomposition CRUD + bottom-up evaluation.

A node with no children is a leaf (value = its manual_value); an internal node
combines its children with its operator (add/sub/mul/div). Each child also gets a
contribution % of its parent's value. Pure arithmetic, no AI.
"""
from __future__ import annotations

from math import prod

from sqlalchemy import delete as sql_delete
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NexusBIException, SchemaNotFoundError
from app.models.metric_node import MetricNode

MAX_DEPTH = 12


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


async def create(db: AsyncSession, user_id: str, payload) -> MetricNode:
    if payload.parent_id is not None:
        await get(db, user_id, payload.parent_id)  # ownership + existence
    node = MetricNode(
        user_id=user_id, parent_id=payload.parent_id, name=payload.name,
        operator=payload.operator, manual_value=payload.manual_value, position=payload.position,
    )
    db.add(node)
    await db.flush()
    await db.refresh(node)
    return node


async def update(db: AsyncSession, user_id: str, node_id: str, payload) -> MetricNode:
    node = await get(db, user_id, node_id)
    # Reparenting is intentionally NOT allowed here — keeps the tree acyclic by
    # construction (a node's parent is fixed at create time).
    for field in ("name", "operator", "manual_value", "position"):
        value = getattr(payload, field, None)
        if value is not None:
            setattr(node, field, value)
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


def _combine(operator: str, values: list[float]) -> float:
    if not values:
        return 0.0
    if operator == "add":
        return float(sum(values))
    if operator == "sub":
        return float(values[0] - sum(values[1:]))
    if operator == "mul":
        return float(prod(values))
    if operator == "div":
        denom = prod(values[1:]) if len(values) > 1 else 1.0
        return float(values[0] / denom) if denom else 0.0
    raise NexusBIException(f"Naməlum operator: {operator}")


def _node_dict(node: MetricNode, value: float, children: list[dict]) -> dict:
    return {"id": node.id, "name": node.name, "operator": node.operator,
            "manual_value": node.manual_value, "value": value, "children": children}


def _eval(node: MetricNode, children: dict[str | None, list[MetricNode]], depth: int) -> dict:
    kids = children.get(node.id, [])
    if not kids or depth >= MAX_DEPTH:
        value = float(node.manual_value) if node.manual_value is not None else 0.0
        return _node_dict(node, value, [])
    child_results = [_eval(k, children, depth + 1) for k in kids]
    value = _combine(node.operator, [c["value"] for c in child_results])
    # "Contribution %" (share of parent) is only meaningful for additive composition;
    # for ×/÷/− a child's value/parent ratio is unbounded/misleading, so leave it None.
    if node.operator == "add" and value:
        for c in child_results:
            c["contribution_pct"] = round(c["value"] / value * 100, 1)
    return _node_dict(node, value, child_results)


async def evaluate(db: AsyncSession, user_id: str) -> list[dict]:
    """Return the evaluated forest (all root nodes) with values + contributions."""
    nodes = await list_nodes(db, user_id)
    children: dict[str | None, list[MetricNode]] = {}
    for n in nodes:
        children.setdefault(n.parent_id, []).append(n)
    roots = children.get(None, [])
    return [_eval(r, children, 0) for r in roots]
