"""Workspace / RBAC / RLS / audit schemas."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

Role = Literal["viewer", "editor", "owner"]


class WorkspaceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)


class WorkspaceResponse(BaseModel):
    id: str
    name: str
    owner_id: str
    role: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class MemberAdd(BaseModel):
    email: str = Field(min_length=3, max_length=255)
    role: Role = "viewer"


class MemberResponse(BaseModel):
    id: str
    user_id: str
    email: str
    role: str


class WorkspaceRename(BaseModel):
    name: str = Field(min_length=1, max_length=255)


class MemberRoleUpdate(BaseModel):
    # Promotion to owner goes through the transfer endpoint, not here.
    role: Literal["viewer", "editor"]


class TransferOwnership(BaseModel):
    member_id: str = Field(min_length=1)


class RLSRuleCreate(BaseModel):
    member_email: str = Field(min_length=3, max_length=255)
    column: str = Field(min_length=1, max_length=255)
    allowed_value: str = Field(min_length=1, max_length=500)


class RLSRuleResponse(BaseModel):
    id: str
    datasource_id: str
    member_id: str
    column: str
    allowed_value: str
    created_at: datetime

    model_config = {"from_attributes": True}


class AuditEntry(BaseModel):
    id: str
    action: str
    entity: str
    entity_id: str | None
    meta: dict[str, Any] | None
    created_at: datetime

    model_config = {"from_attributes": True}
