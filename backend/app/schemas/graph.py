"""Business knowledge graph schemas."""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

NodeType = Literal[
    "table", "metric", "mnode", "dash", "widget", "squery", "decision", "ds", "column"
]
EdgeKind = Literal[
    "hosts", "feeds", "informs", "contains", "rolls_up", "references", "has_column"
]

# Trust/health overlay. ``status`` is the severity the frontend colors by; ``reason``
# is a machine code the frontend localizes (graphPage.health.<reason>) — no language
# is baked into the API. Both optional so nodes without a health notion stay untouched.
HealthStatus = Literal["ok", "warn", "danger", "unknown"]
HealthReason = Literal["verified", "unverified", "fresh", "stale", "unknown"]


class GraphNode(BaseModel):
    id: str
    type: NodeType
    label: str
    ref_id: str | None = None
    status: HealthStatus | None = None
    reason: HealthReason | None = None


class GraphEdge(BaseModel):
    source: str
    target: str
    kind: EdgeKind


class GraphResponse(BaseModel):
    nodes: list[GraphNode]
    edges: list[GraphEdge]


# --- Saved graph views (user-curated overlays over the derived graph) --------
# A view never stores nodes/edges; it stores a filter the frontend applies to the
# single derived graph. ``included_node_ids=None`` ⇒ the full graph; a list ⇒ only
# those nodes. ``hidden_*`` are ids/edge-keys the user removed from the view.


class GraphViewCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    included_node_ids: list[str] | None = None
    hidden_node_ids: list[str] = []
    hidden_edge_keys: list[str] = []


class GraphViewUpdate(BaseModel):
    # All optional so PATCH can touch a single field (applied via exclude_unset).
    name: str | None = Field(default=None, min_length=1, max_length=255)
    included_node_ids: list[str] | None = None
    hidden_node_ids: list[str] | None = None
    hidden_edge_keys: list[str] | None = None


class GraphViewResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    included_node_ids: list[str] | None = None
    hidden_node_ids: list[str] = []
    hidden_edge_keys: list[str] = []
    created_at: datetime
    updated_at: datetime
