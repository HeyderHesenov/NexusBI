"""Business knowledge graph — composes existing assets into {nodes, edges}.

Deterministic (no AI): tables come from ``lineage_service`` over the query logs
already referenced by widgets, saved queries and decisions; table→table edges
come from foreign-key links declared in each datasource's ``schema_cache``. Edge
direction = data flow, so "downstream impact" of a node is a BFS along edge
direction:

    ds → table → widget → dashboard
                 table → decision / saved query
    table → table              (FK: the holder references the referred table)
    metric → widget            (semantic definition informs the chart)
    metric_node child → parent (leaf values roll UP the KPI tree)

Trust overlay: metric and datasource nodes carry a health ``status``/``reason``
(verified metrics, freshness-SLA state) — see ``_metric_status``/``_ds_status``.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.logging import get_logger

from app.models.dashboard import Dashboard, Widget
from app.models.datasource import DataSource
from app.models.decision import Decision
from app.models.metric import Metric
from app.models.metric_node import MetricNode
from app.models.query_log import QueryLog
from app.models.saved_query import SavedQuery
from app.services.lineage_service import lineage_for_query

log = get_logger("nexusbi.graph")

MAX_QUERY_LOGS = 200  # bound the lineage scan (and the frontend layout size)

DEMO_DS_ID = "ds:demo"


def _now() -> datetime:
    """Injectable clock so freshness tests can pin "now" (see decision_service)."""
    return datetime.now(timezone.utc)


def _metric_status(m: Metric) -> tuple[str, str]:
    """Certified metrics are the source of truth; the rest read as a soft warning."""
    return ("ok", "verified") if m.verified else ("warn", "unverified")


def _ds_status(ds: DataSource, now: datetime) -> tuple[str, str]:
    """Freshness SLA state: fresh within the window, stale past it, unknown if
    the source has no SLA or has never been refreshed."""
    if ds.freshness_sla_hours is None or ds.last_refreshed_at is None:
        return ("unknown", "unknown")
    # SQLite drops tz on read (Postgres keeps it) — treat a naive stamp as UTC so
    # the subtraction never mixes aware/naive.
    refreshed = ds.last_refreshed_at
    if refreshed.tzinfo is None:
        refreshed = refreshed.replace(tzinfo=timezone.utc)
    age_h = (now - refreshed).total_seconds() / 3600
    return ("ok", "fresh") if age_h <= ds.freshness_sla_hours else ("danger", "stale")


def _link_fk_edges(g: "_GraphBuilder", datasources: list[DataSource]) -> None:
    """table → table edges from declared foreign keys in each datasource's
    ``schema_cache``. Column ``references`` are "referred_table.col" (see
    ``schema_introspector.get_schema``); direction is holder → referred, matching
    SQL FK semantics. Only links tables already in the graph so the layout stays
    bounded — orphan schema tables are never added.

    NOTE: reads the ``schema_cache`` DB column only (no live introspection), so it
    is deterministic and hermetic. The column is populated when a source is
    introspected; until then FK edges are simply absent.
    """
    for ds in datasources:
        schema = ds.schema_cache
        if not isinstance(schema, dict):
            continue
        for table_name, columns in schema.items():
            holder = f"table:{table_name.lower()}"
            if holder not in g.nodes or not isinstance(columns, list):
                continue
            for col in columns:
                ref = col.get("references") if isinstance(col, dict) else None
                if not ref or "." not in ref:
                    continue
                referred = f"table:{ref.split('.', 1)[0].lower()}"
                if referred in g.nodes:
                    g.edge(holder, referred, "references")


class _GraphBuilder:
    def __init__(self) -> None:
        self.nodes: dict[str, dict[str, Any]] = {}
        self.edges: set[tuple[str, str, str]] = set()

    def node(
        self,
        node_id: str,
        type_: str,
        label: str,
        ref_id: str | None = None,
        status: str | None = None,
        reason: str | None = None,
    ) -> str:
        if node_id not in self.nodes:
            self.nodes[node_id] = {
                "id": node_id, "type": type_, "label": label, "ref_id": ref_id,
                "status": status, "reason": reason,
            }
        return node_id

    def edge(self, source: str, target: str, kind: str) -> None:
        if source != target:
            self.edges.add((source, target, kind))

    def table(self, name: str) -> str:
        return self.node(f"table:{name.lower()}", "table", name.lower())

    def result(self) -> dict[str, Any]:
        return {
            "nodes": list(self.nodes.values()),
            "edges": [
                {"source": s, "target": t, "kind": k} for s, t, k in sorted(self.edges)
            ],
        }


async def build(
    db: AsyncSession, user_id: str, include_columns: bool = False
) -> dict[str, Any]:
    g = _GraphBuilder()
    now = _now()

    metrics = list(
        (await db.execute(select(Metric).where(Metric.user_id == user_id))).scalars()
    )
    for m in metrics:
        status, reason = _metric_status(m)
        g.node(f"metric:{m.id}", "metric", m.name, m.id, status, reason)

    datasources = list(
        (await db.execute(select(DataSource).where(DataSource.user_id == user_id))).scalars()
    )
    # The synthetic demo source has no SLA/refresh notion → leave it status-less.
    ds_node_by_id: dict[str | None, str] = {
        None: g.node(DEMO_DS_ID, "ds", "Demo")
    }
    for ds in datasources:
        status, reason = _ds_status(ds, now)
        ds_node_by_id[ds.id] = g.node(f"ds:{ds.id}", "ds", ds.name, ds.id, status, reason)

    # Query logs are loaded once for every asset that references them.
    dashboards = list(
        (
            await db.execute(
                select(Dashboard)
                .where(Dashboard.user_id == user_id)
                .options(selectinload(Dashboard.widgets))  # async lazy-load is an error
            )
        ).scalars()
    )
    widgets: list[Widget] = [w for d in dashboards for w in d.widgets]
    saved = list(
        (await db.execute(select(SavedQuery).where(SavedQuery.user_id == user_id))).scalars()
    )
    decisions = list(
        (await db.execute(select(Decision).where(Decision.user_id == user_id))).scalars()
    )

    log_ids = (
        {w.query_log_id for w in widgets if w.query_log_id}
        | {s.last_query_log_id for s in saved if s.last_query_log_id}
        | {d.query_log_id for d in decisions if d.query_log_id}
    )
    logs_by_id: dict[str, QueryLog] = {}
    if log_ids:
        rows = await db.execute(
            select(QueryLog)
            .where(QueryLog.id.in_(log_ids), QueryLog.user_id == user_id)
            .order_by(QueryLog.created_at.desc())
            .limit(MAX_QUERY_LOGS)
        )
        logs_by_id = {q.id: q for q in rows.scalars().all()}
        if len(log_ids) > len(logs_by_id):
            # No silent caps: assets referencing the dropped (older) logs will
            # render without lineage edges — say so in the logs.
            log.info(
                "graph_lineage_truncated",
                referenced=len(log_ids),
                loaded=len(logs_by_id),
            )

    # Case-insensitive to mirror lineage_service._unique's dedupe semantics.
    metric_id_by_name = {m.name.lower(): m.id for m in reversed(metrics)}
    lineage_cache: dict[str, dict] = {}  # a log shared by several assets parses once

    def _link_lineage(log_id: str | None, target_node: str) -> None:
        """table → target and metric → target edges from a query log's lineage."""
        qlog = logs_by_id.get(log_id) if log_id else None
        if qlog is None:
            return
        lin = lineage_cache.get(qlog.id)
        if lin is None:
            lin = lineage_cache[qlog.id] = lineage_for_query(qlog, metrics)
        for table in lin["tables"]:
            tnode = g.table(table)
            g.edge(ds_node_by_id.get(qlog.datasource_id, ds_node_by_id[None]), tnode, "hosts")
            g.edge(tnode, target_node, "feeds")
        for metric_name in lin["metrics"]:
            metric_id = metric_id_by_name.get(metric_name.lower())
            if metric_id:
                g.edge(f"metric:{metric_id}", target_node, "informs")
        # Column-level lineage (opt-in): only when a query has a single source
        # table can we attribute its output columns unambiguously; joins are skipped.
        if include_columns and len(lin["tables"]) == 1:
            tnode = g.table(lin["tables"][0])
            for col in lin["columns"]:
                cnode = g.node(f"column:{tnode[6:]}.{col.lower()}", "column", col)
                g.edge(tnode, cnode, "has_column")
                g.edge(cnode, target_node, "feeds")

    for dash in dashboards:
        dnode = g.node(f"dash:{dash.id}", "dash", dash.name, dash.id)
        for w in dash.widgets:
            wnode = g.node(f"widget:{w.id}", "widget", w.title or dash.name, w.id)
            g.edge(wnode, dnode, "contains")
            _link_lineage(w.query_log_id, wnode)

    for s in saved:
        snode = g.node(f"squery:{s.id}", "squery", s.name, s.id)
        _link_lineage(s.last_query_log_id, snode)

    for d in decisions:
        dnode = g.node(f"decision:{d.id}", "decision", d.title, d.id)
        _link_lineage(d.query_log_id, dnode)

    # FK edges run after lineage so both endpoint tables already exist as nodes.
    _link_fk_edges(g, datasources)

    mnodes = list(
        (await db.execute(select(MetricNode).where(MetricNode.user_id == user_id))).scalars()
    )
    for n in mnodes:
        g.node(f"mnode:{n.id}", "mnode", n.name, n.id)
    for n in mnodes:
        if n.parent_id:
            # Leaf values roll UP: child → parent is the data-flow direction.
            g.edge(f"mnode:{n.id}", f"mnode:{n.parent_id}", "rolls_up")

    return g.result()
