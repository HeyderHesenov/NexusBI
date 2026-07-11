"""DataSource request/response schemas."""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class DataSourceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    db_type: Literal["postgresql", "mysql", "sqlite"]
    connection_string: str = Field(min_length=1)


class PowerBIConnectRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    dataset_id: str = Field(min_length=1)


class PowerBIDataset(BaseModel):
    id: str
    name: str
    workspace: str = ""


class DataSourceSLAUpdate(BaseModel):
    freshness_sla_hours: int | None = Field(default=None, ge=1, le=8760)


class DataSourceResponse(BaseModel):
    id: str
    name: str
    db_type: str
    freshness_sla_hours: int | None = None
    last_refreshed_at: datetime | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class DataRefreshResponse(BaseModel):
    """Result of replacing a file-backed source's data in place."""

    datasource: DataSourceResponse
    rows: int
    # Raw identifiers (table / table.column) present in the OLD data but gone in the
    # NEW upload — the client localizes the surrounding message. Empty = clean swap.
    warnings: list[str] = Field(default_factory=list)
