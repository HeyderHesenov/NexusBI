"""Query request/response schemas."""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from app.ai.types import ChartConfig


class ColumnInfo(BaseModel):
    name: str
    type: str = "unknown"


class QueryRequest(BaseModel):
    nl_query: str = Field(min_length=1, max_length=2000)
    datasource_id: str | None = None
    # Previous turn for multi-turn "chat with your data" follow-ups.
    previous_query_log_id: str | None = None


class RawSQLRequest(BaseModel):
    """Power-user path: run analyst-authored SQL directly (no AI generation)."""

    sql: str = Field(min_length=1, max_length=20000)
    datasource_id: str | None = None
    # Optional short history label; the SQL's first line is used when omitted.
    label: str | None = Field(default=None, max_length=200)


class StatFact(BaseModel):
    kind: str  # total | top | trend | anomaly
    label: str
    value: str


class QueryResult(BaseModel):
    sql: str
    # "sql" for database sources, "dax" for Power BI sources (UI labels it).
    query_language: str = "sql"
    data: list[dict[str, Any]]
    columns: list[ColumnInfo]
    chart_config: ChartConfig
    insight: str = ""
    # Deterministic computed facts (math, not LLM) shown as chips under the insight.
    stats_facts: list[StatFact] = Field(default_factory=list)
    execution_time_ms: int = 0
    query_log_id: str | None = None
    from_cache: bool = False
    # Answer-trust signal for the UI badge. `provenance`: llm | deterministic_fallback
    # | self_repaired | user_sql (None on legacy logs → no badge). `confidence` is the
    # model's own 0–1 score, only meaningful for provenance="llm".
    confidence: float | None = None
    provenance: str | None = None


class QueryHistoryItem(BaseModel):
    id: str
    natural_language: str
    generated_sql: str
    chart_type: str
    execution_time_ms: int
    created_at: str
    # Answer-trust signal (None on legacy rows → no badge in the history list).
    confidence: float | None = None
    provenance: str | None = None


class QueryHistoryPage(BaseModel):
    items: list[QueryHistoryItem]
    page: int
    limit: int
    total: int
