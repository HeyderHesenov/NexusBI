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


class DataSourceRLSModeUpdate(BaseModel):
    """Lock ("strict") or unlock ("open") a source for members without a rule."""

    rls_mode: Literal["open", "strict"]


class DataSourceResponse(BaseModel):
    id: str
    name: str
    db_type: str
    # No default. Every construction today is model_validate() off an ORM row,
    # so nothing relies on one — and a default here would be a third copy of a
    # value the model comment says must stay in step, sitting at the permissive
    # end. A caller that builds this from a dict or a cache entry would have
    # reported "open" for a strict source, and the frontend's matching
    # `?? 'open'` fallback would have drawn the unlocked icon.
    rls_mode: str
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
