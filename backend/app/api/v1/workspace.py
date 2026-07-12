"""Workspace + membership (RBAC) and audit endpoints."""
from __future__ import annotations

from fastapi import APIRouter, Response, status

from app.core.exceptions import SchemaNotFoundError
from app.dependencies import CurrentUser, DbDep
from app.schemas.workspace import (
    AuditEntry,
    MemberAdd,
    MemberResponse,
    MemberRoleUpdate,
    ResourceShare,
    SharedResourceResponse,
    TransferOwnership,
    WorkspaceCreate,
    WorkspaceRename,
    WorkspaceResponse,
)
from app.services import audit_service
from app.services import resource_share_service
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


@router.patch("/workspaces/{workspace_id}", response_model=WorkspaceResponse)
async def rename_workspace(
    workspace_id: str, payload: WorkspaceRename, user: CurrentUser, db: DbDep
) -> WorkspaceResponse:
    ws = await svc.rename(db, workspace_id, user.id, payload.name)
    await audit_service.log(
        db, user.id, "workspace.rename", entity="workspace", entity_id=ws.id
    )
    role = await svc.get_role(db, ws.id, user.id)
    return WorkspaceResponse(
        id=ws.id, name=ws.name, owner_id=ws.owner_id, role=role, created_at=ws.created_at
    )


@router.patch(
    "/workspaces/{workspace_id}/members/{member_id}", response_model=MemberResponse
)
async def change_member_role(
    workspace_id: str, member_id: str, payload: MemberRoleUpdate, user: CurrentUser, db: DbDep
) -> MemberResponse:
    member = await svc.change_role(db, workspace_id, user.id, member_id, payload.role)
    await audit_service.log(
        db, user.id, "workspace.member_role", entity="workspace", entity_id=workspace_id,
        meta={"member": member.user_id, "role": member.role},
    )
    email = next(
        (m["email"] for m in await svc.list_members(db, workspace_id, user.id) if m["id"] == member.id),
        "",
    )
    return MemberResponse(id=member.id, user_id=member.user_id, email=email, role=member.role)


@router.post("/workspaces/{workspace_id}/transfer", status_code=status.HTTP_204_NO_CONTENT)
async def transfer_workspace(
    workspace_id: str, payload: TransferOwnership, user: CurrentUser, db: DbDep
) -> Response:
    new_owner_id = await svc.transfer_ownership(db, workspace_id, user.id, payload.member_id)
    await audit_service.log(
        db, user.id, "workspace.transfer", entity="workspace", entity_id=workspace_id,
        meta={"new_owner": new_owner_id},
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/workspaces/{workspace_id}/leave", status_code=status.HTTP_204_NO_CONTENT)
async def leave_workspace(workspace_id: str, user: CurrentUser, db: DbDep) -> Response:
    await svc.leave(db, workspace_id, user.id)
    await audit_service.log(
        db, user.id, "workspace.leave", entity="workspace", entity_id=workspace_id
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/workspaces/{workspace_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_workspace(workspace_id: str, user: CurrentUser, db: DbDep) -> Response:
    await svc.delete(db, workspace_id, user.id)
    await audit_service.log(
        db, user.id, "workspace.delete", entity="workspace", entity_id=workspace_id
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ─── Shared resources (dashboards + datasources shared to the team) ───

@router.post(
    "/workspaces/{workspace_id}/resources",
    response_model=SharedResourceResponse,
    status_code=status.HTTP_201_CREATED,
)
async def share_resource(
    workspace_id: str, payload: ResourceShare, user: CurrentUser, db: DbDep
) -> SharedResourceResponse:
    await resource_share_service.share(
        db, workspace_id, user.id, payload.resource_type, payload.resource_id, payload.permission
    )
    await audit_service.log(
        db, user.id, "workspace.share", entity="workspace", entity_id=workspace_id,
        meta={"type": payload.resource_type, "resource": payload.resource_id},
    )
    shared = await resource_share_service.list_shared(
        db, workspace_id, user.id, payload.resource_type
    )
    row = next((s for s in shared if s["resource_id"] == payload.resource_id), None)
    if row is None:  # pragma: no cover — just shared, so it exists
        raise SchemaNotFoundError("Paylaşım tapılmadı.")
    return SharedResourceResponse(**row)


@router.get(
    "/workspaces/{workspace_id}/resources", response_model=list[SharedResourceResponse]
)
async def list_resources(
    workspace_id: str, user: CurrentUser, db: DbDep, type: str | None = None
) -> list[SharedResourceResponse]:
    shared = await resource_share_service.list_shared(db, workspace_id, user.id, type)
    return [SharedResourceResponse(**s) for s in shared]


@router.delete(
    "/workspaces/{workspace_id}/resources/{resource_type}/{resource_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def unshare_resource(
    workspace_id: str, resource_type: str, resource_id: str, user: CurrentUser, db: DbDep
) -> Response:
    await resource_share_service.unshare(db, workspace_id, user.id, resource_type, resource_id)
    await audit_service.log(
        db, user.id, "workspace.unshare", entity="workspace", entity_id=workspace_id,
        meta={"type": resource_type, "resource": resource_id},
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/audit", response_model=list[AuditEntry])
async def list_audit(user: CurrentUser, db: DbDep) -> list[AuditEntry]:
    return [AuditEntry.model_validate(a) for a in await audit_service.list_for_user(db, user.id)]
