"""Workspace + membership (RBAC) and audit endpoints."""
from __future__ import annotations

from fastapi import APIRouter, Response, status

from app.dependencies import CurrentUser, DbDep
from app.schemas.workspace import (
    AuditEntry,
    MemberAdd,
    MemberResponse,
    WorkspaceCreate,
    WorkspaceResponse,
)
from app.services import audit_service
from app.services import workspace_service as svc

router = APIRouter(tags=["workspace"])


@router.post("/workspaces", response_model=WorkspaceResponse, status_code=status.HTTP_201_CREATED)
async def create_workspace(
    payload: WorkspaceCreate, user: CurrentUser, db: DbDep
) -> WorkspaceResponse:
    ws = await svc.create(db, user.id, payload.name)
    await audit_service.log(db, user.id, "workspace.create", entity="workspace", entity_id=ws.id)
    return WorkspaceResponse(
        id=ws.id, name=ws.name, owner_id=ws.owner_id, role="owner", created_at=ws.created_at
    )


@router.get("/workspaces", response_model=list[WorkspaceResponse])
async def list_workspaces(user: CurrentUser, db: DbDep) -> list[WorkspaceResponse]:
    out: list[WorkspaceResponse] = []
    for ws in await svc.list_mine(db, user.id):
        role = await svc.get_role(db, ws.id, user.id)
        out.append(
            WorkspaceResponse(
                id=ws.id, name=ws.name, owner_id=ws.owner_id, role=role, created_at=ws.created_at
            )
        )
    return out


@router.get("/workspaces/{workspace_id}/members", response_model=list[MemberResponse])
async def list_members(workspace_id: str, user: CurrentUser, db: DbDep) -> list[MemberResponse]:
    return [MemberResponse(**m) for m in await svc.list_members(db, workspace_id, user.id)]


@router.post(
    "/workspaces/{workspace_id}/members",
    response_model=MemberResponse,
    status_code=status.HTTP_201_CREATED,
)
async def add_member(
    workspace_id: str, payload: MemberAdd, user: CurrentUser, db: DbDep
) -> MemberResponse:
    member = await svc.add_member(db, workspace_id, user.id, payload.email, payload.role)
    await audit_service.log(
        db, user.id, "workspace.member_add", entity="workspace", entity_id=workspace_id,
        meta={"member": member.user_id, "role": member.role},
    )
    email = next(
        (m["email"] for m in await svc.list_members(db, workspace_id, user.id) if m["id"] == member.id),
        payload.email,
    )
    return MemberResponse(id=member.id, user_id=member.user_id, email=email, role=member.role)


@router.delete(
    "/workspaces/{workspace_id}/members/{member_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def remove_member(
    workspace_id: str, member_id: str, user: CurrentUser, db: DbDep
) -> Response:
    await svc.remove_member(db, workspace_id, user.id, member_id)
    await audit_service.log(
        db, user.id, "workspace.member_remove", entity="workspace", entity_id=workspace_id,
        meta={"member": member_id},
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/audit", response_model=list[AuditEntry])
async def list_audit(user: CurrentUser, db: DbDep) -> list[AuditEntry]:
    return [AuditEntry.model_validate(a) for a in await audit_service.list_for_user(db, user.id)]
