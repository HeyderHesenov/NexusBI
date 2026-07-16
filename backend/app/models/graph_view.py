"""GraphView model — a saved, named curation of the derived knowledge graph.

The graph itself is composed on read (``graph_service.build``) and is never stored.
A GraphView is just a lightweight config the frontend applies to that single
derived payload: which nodes to include (``None`` = the whole graph) and which
nodes/edges to hide. No node/edge is ever destroyed — this only filters the view.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


def _uuid() -> str:
    return str(uuid.uuid4())


class GraphView(Base, TimestampMixin):
    __tablename__ = "graph_views"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    # None ⇒ start from the FULL derived graph; a list ⇒ only these node ids.
    included_node_ids: Mapped[list | None] = mapped_column(JSON, nullable=True)
    # Nodes/edges the user removed from view. default=list (callable) avoids the
    # shared-mutable-default trap; edge keys are the directed "src\x00tgt\x00kind".
    hidden_node_ids: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    hidden_edge_keys: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    # TimestampMixin only gives created_at; declare updated_at explicitly.
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
