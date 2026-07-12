"""Team workspaces, role membership, row-level security rules, and audit log.

All additive: existing personal resources are untouched. Workspaces add a team
layer (RBAC), per-datasource row filters (RLS), and an action audit trail.
"""
from __future__ import annotations

import uuid

from sqlalchemy import JSON, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin

# Role ordering for "at least this role" checks.
ROLES = ("viewer", "editor", "owner")


def _uuid() -> str:
    return str(uuid.uuid4())


class Workspace(Base, TimestampMixin):
    __tablename__ = "workspaces"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    owner_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)


class WorkspaceMember(Base, TimestampMixin):
    __tablename__ = "workspace_members"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    workspace_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("workspaces.id", ondelete="CASCADE"), index=True, nullable=False
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    role: Mapped[str] = mapped_column(String(20), nullable=False, default="viewer")


class RLSRule(Base, TimestampMixin):
    """Row-level filter: a member only sees rows where ``column`` == ``allowed_value``."""

    __tablename__ = "rls_rules"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    datasource_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("datasources.id", ondelete="CASCADE"), index=True, nullable=False
    )
    owner_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    # The member the rule applies to (the datasource owner shares with them).
    member_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    column: Mapped[str] = mapped_column(String(255), nullable=False)
    allowed_value: Mapped[str] = mapped_column(String(500), nullable=False)


class WorkspaceResource(Base, TimestampMixin):
    """A dashboard or datasource shared to a workspace (all members can see it).

    Additive: the shared resource stays owned by ``shared_by`` — this is a grant,
    not a move. ``permission`` is reserved for a future editor-edit path; v1
    renders shared dashboards read-only and grants query-only access to shared
    datasources.
    """

    __tablename__ = "workspace_resources"
    __table_args__ = (
        UniqueConstraint(
            "workspace_id", "resource_type", "resource_id", name="uq_ws_resource"
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    workspace_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("workspaces.id", ondelete="CASCADE"), index=True, nullable=False
    )
    resource_type: Mapped[str] = mapped_column(String(20), nullable=False)  # dashboard | datasource
    resource_id: Mapped[str] = mapped_column(String(36), index=True, nullable=False)
    shared_by: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    permission: Mapped[str] = mapped_column(String(10), nullable=False, default="view")


class AuditLog(Base, TimestampMixin):
    __tablename__ = "audit_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    action: Mapped[str] = mapped_column(String(80), nullable=False)
    entity: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    entity_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    meta: Mapped[dict | None] = mapped_column(JSON, nullable=True)
