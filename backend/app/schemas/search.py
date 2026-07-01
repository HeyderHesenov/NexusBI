"""Global asset-search schemas."""
from __future__ import annotations

from pydantic import BaseModel


class SearchHitResponse(BaseModel):
    kind: str  # dashboard | metric_asset | saved_query
    ref_id: str
    title: str
    score: float


class ReindexResponse(BaseModel):
    indexed: int
