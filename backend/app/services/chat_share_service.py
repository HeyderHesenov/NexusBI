"""Share an app artifact into team chat as a rich card.

A member picks one of THEIR OWN artifacts (chart result, dashboard, report, ML
model, BA artifact, decision, data contract or metric) and posts it into a room
they can access. The card is a ``ChatMessage`` authored by the sharer with a
server-built ``meta`` payload (``kind: "share"`` — never ``ai``):

- ``query_log`` cards embed a bounded copy of the log's stored result snapshot
  plus its chart config, so every room member sees the rendered chart without
  re-execution or any datasource access — screenshot semantics: the sharer
  deliberately discloses exactly what they saw (SQL is NOT included).
- every other type is a reference card (title + subtitle) whose "open" chip
  navigates via the same action mapping the copilot chips use.
"""
from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import SchemaNotFoundError
from app.models.chat import ChatMessage
from app.models.query_log import QueryLog
from app.models.user import User
from app.schemas.chat import ShareRequest
from app.services import (
    automl_service,
    ba_service,
    chat_service,
    dashboard_service,
    data_contract_service,
    decision_service,
    metric_service,
    query_service,
    saved_query_service,
)

# Chat cards carry a tighter copy of the (already bounded) stored snapshot —
# a share lands in every member's history fetch and renders into a small card,
# so keep it lean; a `truncated` flag tells the card when rows were dropped.
_CHAT_MAX_ROWS = 100
_CHAT_MAX_BYTES = 32 * 1024

Loader = Callable[[AsyncSession, str, str], Awaitable[dict[str, Any]]]


async def _load_query_log(db: AsyncSession, user_id: str, rid: str) -> dict[str, Any]:
    # Owner-scoped select lives here (the history getter is router-level; a
    # service importing from the API layer would invert the layering).
    log = (
        await db.execute(
            select(QueryLog).where(QueryLog.id == rid, QueryLog.user_id == user_id)
        )
    ).scalar_one_or_none()
    if log is None:
        raise SchemaNotFoundError("Sorğu tapılmadı.")
    data = log.result_data or {"columns": [], "rows": []}
    all_rows = data.get("rows", [])
    rows = query_service.snapshot_rows(
        all_rows, max_rows=_CHAT_MAX_ROWS, max_bytes=_CHAT_MAX_BYTES
    )
    cfg = log.chart_config or {}
    chart_type = cfg.get("chart_type") or log.chart_type or "table"
    chart: dict[str, Any] = {
        "chart_type": chart_type,
        "chart_config": {**cfg, "chart_type": chart_type},
        "columns": data.get("columns", []),
        "data": rows,
        "insight": log.insight or "",
    }
    if len(rows) < len(all_rows):
        chart["truncated"] = True
    return {
        "title": log.natural_language[:255],
        "subtitle": (log.insight or "")[:200],
        "chart": chart,
    }


async def _load_dashboard(db: AsyncSession, user_id: str, rid: str) -> dict[str, Any]:
    dash = await dashboard_service.get_dashboard(db, user_id, rid)
    return {"title": dash.name[:255], "subtitle": (dash.description or "")[:200]}


async def _load_saved_query(db: AsyncSession, user_id: str, rid: str) -> dict[str, Any]:
    sq = await saved_query_service.get(db, user_id, rid)
    return {"title": sq.name[:255], "subtitle": sq.schedule or ""}


async def _load_ml_model(db: AsyncSession, user_id: str, rid: str) -> dict[str, Any]:
    model = await automl_service.get(db, user_id, rid)
    return {
        "title": (model.name or model.source_table)[:255],
        "subtitle": f"{model.problem_type} · {model.best_algo}",
    }


async def _load_ba_artifact(db: AsyncSession, user_id: str, rid: str) -> dict[str, Any]:
    artifact = await ba_service.get(db, user_id, rid)
    return {"title": (artifact.title or artifact.framework)[:255], "subtitle": artifact.framework}


async def _load_decision(db: AsyncSession, user_id: str, rid: str) -> dict[str, Any]:
    decision = await decision_service.get(db, user_id, rid)
    return {"title": decision.title[:255], "subtitle": decision.status}


async def _load_contract(db: AsyncSession, user_id: str, rid: str) -> dict[str, Any]:
    contract = await data_contract_service.get(db, user_id, rid)
    return {"title": contract.name[:255], "subtitle": contract.last_status}


async def _load_metric(db: AsyncSession, user_id: str, rid: str) -> dict[str, Any]:
    metric = await metric_service.get(db, user_id, rid)
    return {"title": metric.name[:255], "subtitle": (metric.expression or "")[:200]}


_LOADERS: dict[str, Loader] = {
    "query_log": _load_query_log,
    "dashboard": _load_dashboard,
    "saved_query": _load_saved_query,
    "ml_model": _load_ml_model,
    "ba_artifact": _load_ba_artifact,
    "decision": _load_decision,
    "contract": _load_contract,
    "metric": _load_metric,
}


async def share(db: AsyncSession, user: User, payload: ShareRequest) -> ChatMessage:
    """Validate ownership, build the card meta, post it as the sharer.

    Room access is enforced inside ``post_message``; ownership by the loaders.
    ``meta.caption`` carries the user's note explicitly (may be "") so the
    client never has to reverse-engineer whether ``content`` fell back to the
    title."""
    card = await _LOADERS[payload.resource_type](db, user.id, payload.resource_id)
    caption = payload.caption.strip()
    meta = {
        "kind": "share",
        "resource_type": payload.resource_type,
        "resource_id": payload.resource_id,
        "caption": caption,
        **card,
    }
    content = caption or card["title"].strip() or "…"
    return await chat_service.post_message(
        db, payload.room_key, user.id, user.full_name or user.email, content, meta=meta
    )
