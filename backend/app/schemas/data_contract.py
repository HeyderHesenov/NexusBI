"""Data contract schemas."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

Rule = Literal["not_null", "unique", "min", "max", "range", "freshness", "schema"]


class ExpectationItem(BaseModel):
    column: str | None = None
    rule: Rule
    params: dict[str, Any] = Field(default_factory=dict)


class DataContractCreate(BaseModel):
    datasource_id: str
    table_name: str = Field(min_length=1, max_length=255)
    name: str = Field(min_length=1, max_length=255)
    expectations: list[ExpectationItem] = Field(default_factory=list)


class DataContractResponse(BaseModel):
    id: str
    datasource_id: str
    table_name: str
    name: str
    expectations: list[dict]
    schema_hash: str | None
    last_status: str
    last_run_at: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}


class ContractRunResponse(BaseModel):
    id: str
    status: str
    results: list[dict]
    created_at: datetime

    model_config = {"from_attributes": True}
