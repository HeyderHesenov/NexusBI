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


class DataSourceResponse(BaseModel):
    id: str
    name: str
    db_type: str
    created_at: datetime

    model_config = {"from_attributes": True}
