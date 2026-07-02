"""Business knowledge graph schemas."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

NodeType = Literal["table", "metric", "mnode", "dash", "widget", "squery", "decision", "ds"]
EdgeKind = Literal["hosts", "feeds", "informs", "contains", "rolls_up"]


class GraphNode(BaseModel):
    id: str
    type: NodeType
    label: str
    ref_id: str | None = None


class GraphEdge(BaseModel):
    source: str
    target: str
    kind: EdgeKind


class GraphResponse(BaseModel):
    nodes: list[GraphNode]
    edges: list[GraphEdge]
