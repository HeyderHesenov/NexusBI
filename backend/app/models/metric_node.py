"""Metric tree node — a KPI decomposition (e.g. revenue = price × volume).

A self-referential tree: a node with no children is a leaf, an internal node
combines its children with `operator`.

A leaf's value has a PROVENANCE. Historically every leaf was a hand-typed
`manual_value` float, and nothing downstream could tell that apart from a
measured number — the copilot presented both as KPIs, and the whole Digital Twin
(Monte Carlo, goal seek, tornado, narrative prose) built confident stories on
them. So a leaf now declares where its number comes from:

  ``source_kind='manual'`` — `manual_value`, an ASSUMPTION the user typed.
  ``source_kind='query'``  — measured from `saved_query_id`'s last stored run:
                             aggregate `value_column` with `agg`.

Neither kind is allowed to fabricate. A manual leaf with no `manual_value`, and
a query leaf whose binding cannot be resolved, both evaluate to *unknown* rather
than to 0.0 — see ``services/metric_tree_service.resolve_leaf``.
"""
from __future__ import annotations

import uuid

from sqlalchemy import Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin

SOURCE_MANUAL = "manual"
SOURCE_QUERY = "query"

# Aggregations a query-bound leaf may apply to its column. "last" is the final
# row of the stored result as the engine returned it — the saved query's own
# ORDER BY is the only ordering we can honour here.
AGGREGATIONS = ("sum", "avg", "min", "max", "last", "count")


def _uuid() -> str:
    return str(uuid.uuid4())


class MetricNode(Base, TimestampMixin):
    __tablename__ = "metric_nodes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    parent_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("metric_nodes.id", ondelete="CASCADE"), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    operator: Mapped[str] = mapped_column(String(8), nullable=False, default="add")  # add|sub|mul|div
    manual_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # ── Provenance ──
    # server_default is spelled here AND in the migration with the same literal:
    # the schema-drift guard (scripts/check_schema_drift.py) compares the two, and
    # a default that lives in only one of them is exactly the class of bug that
    # left `rls_mode` fail-open in the test schema.
    source_kind: Mapped[str] = mapped_column(
        String(8), nullable=False, default=SOURCE_MANUAL, server_default=SOURCE_MANUAL
    )
    # SET NULL, not CASCADE: deleting the saved query must not delete the KPI node.
    # The leaf survives and reports itself unknown, which is the honest outcome —
    # the decomposition is still meaningful, its number just is not measurable.
    saved_query_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("saved_queries.id", ondelete="SET NULL"), nullable=True
    )
    value_column: Mapped[str | None] = mapped_column(String(255), nullable=True)
    agg: Mapped[str | None] = mapped_column(String(8), nullable=True)
