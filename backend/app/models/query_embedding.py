"""Vector index for RAG grounding of Text2SQL.

Portable by design: the embedding is stored as a JSON float array and similarity
is computed in Python (numpy cosine) over a bounded candidate set — no pgvector /
Postgres dependency. ``user_id`` NULL means a global entry (e.g. a shared verified
metric); retrieval is otherwise scoped to the requesting user.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


def _uuid() -> str:
    return str(uuid.uuid4())


class QueryEmbedding(Base):
    __tablename__ = "query_embeddings"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=True
    )
    datasource_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    # RAG kinds: "query" (NL→SQL example) | "metric" (verified semantic term).
    # Asset-search kinds: "dashboard" | "metric_asset" | "saved_query".
    kind: Mapped[str] = mapped_column(String(20), nullable=False, default="query")
    # For asset-search entries: id of the source asset (dashboard/metric/saved query).
    ref_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    sql: Mapped[str | None] = mapped_column(Text, nullable=True)
    embedding: Mapped[list[float]] = mapped_column(JSON, nullable=False)
    dim: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
