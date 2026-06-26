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


class QueryResult(BaseModel):
    sql: str
    # "sql" for database sources, "dax" for Power BI sources (UI labels it).
    query_language: str = "sql"
    data: list[dict[str, Any]]
    columns: list[ColumnInfo]
    chart_config: ChartConfig
    insight: str = ""
    execution_time_ms: int = 0
    query_log_id: str | None = None
    from_cache: bool = False


class QueryHistoryItem(BaseModel):
    id: str
    natural_language: str
    generated_sql: str
    chart_type: str
    execution_time_ms: int
    created_at: str


class QueryHistoryPage(BaseModel):
    items: list[QueryHistoryItem]
    page: int
    limit: int
    total: int
