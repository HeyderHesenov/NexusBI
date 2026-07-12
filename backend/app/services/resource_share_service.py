"""Share dashboards / datasources to a workspace (team-visible resources).

A share is a GRANT, not a move: the resource stays owned by whoever shared it.
Members of the workspace get read access (dashboards render read-only "as the
owner"; datasources become query-only for members, still RLS-constrained). All
sharing is keyed by the shared resource's real owner, so mutations never leak.
"""
from __future__ import annotations

from sqlalchemy import delete as sa_delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ForbiddenError, SchemaNotFoundError
from app.models.dashboard import Dashboard
from app.models.datasource import DataSource
from app.models.workspace import WorkspaceMember, WorkspaceResource
from app.services import workspace_service

_TYPES = ("dashboard", "datasource")


async def _assert_owns(db: AsyncSession, user_id: str, resource_type: str, resource_id: str) -> str:
    """Verify ``user_id`` owns the resource; return its name. Raises 404 otherwise.

    Only what you own can be shared — this is checked against the real owner
    column, so a member of the workspace can't re-share someone else's resource.
    """
    if resource_type == "dashboard":
        row = await db.execute(
            select(Dashboard.name).where(Dashboard.id == resource_id, Dashboard.user_id == user_id)
        )
    else:
        row = await db.execute(
            select(DataSource.name).where(DataSource.id == resource_id, DataSource.user_id == user_id)
        )
    name = row.scalar_one_or_none()
    if name is None:
        raise SchemaNotFoundError("Resurs tapılmadı və ya sənə aid deyil.")
    return name


async def share(
    db: AsyncSession,
    workspace_id: str,
    actor_id: str,
    resource_type: str,
    resource_id: str,
    permission: str = "view",
) -> WorkspaceResource:
    """Share a dashboard/datasource to a workspace (editor+; must own the resource)."""
    if resource_type not in _TYPES:
        raise ForbiddenError("Naməlum resurs tipi.")
    await workspace_service.require_role(db, workspace_id, actor_id, "editor")
    await _assert_owns(db, actor_id, resource_type, resource_id)
    existing = (
        await db.execute(
            select(WorkspaceResource).where(
                WorkspaceResource.workspace_id == workspace_id,
                WorkspaceResource.resource_type == resource_type,
                WorkspaceResource.resource_id == resource_id,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        existing.permission = permission
        existing.shared_by = actor_id
        await db.flush()
        return existing
    res = WorkspaceResource(
        workspace_id=workspace_id,
        resource_type=resource_type,
        resource_id=resource_id,
        shared_by=actor_id,
        permission=permission,
    )
    db.add(res)
    await db.flush()
    await db.refresh(res)
    return res


async def unshare(
    db: AsyncSession, workspace_id: str, actor_id: str, resource_type: str, resource_id: str
) -> None:
    """Remove a share (the workspace owner OR the member who shared it)."""
    role = await workspace_service.require_role(db, workspace_id, actor_id, "viewer")
    res = (
        await db.execute(
            select(WorkspaceResource).where(
                WorkspaceResource.workspace_id == workspace_id,
                WorkspaceResource.resource_type == resource_type,
                WorkspaceResource.resource_id == resource_id,
            )
        )
    ).scalar_one_or_none()
    if res is None:
        raise SchemaNotFoundError("Paylaşım tapılmadı.")
    if role != "owner" and res.shared_by != actor_id:
        raise ForbiddenError("Yalnız sahib və ya paylaşan bunu geri ala bilər.")
    await db.delete(res)
    await db.flush()


async def list_shared(
    db: AsyncSession, workspace_id: str, user_id: str, resource_type: str | None = None
) -> list[dict]:
    """Shared resources in a workspace (member only), with name + owner_id.

    Dangling shares (resource since deleted) are skipped, so a deleted dashboard
    never surfaces as a broken row.
    """
    await workspace_service.require_role(db, workspace_id, user_id, "viewer")
    q = select(WorkspaceResource).where(WorkspaceResource.workspace_id == workspace_id)
    if resource_type is not None:
        q = q.where(WorkspaceResource.resource_type == resource_type)
    rows = list((await db.execute(q.order_by(WorkspaceResource.created_at.desc()))).scalars().all())
    if not rows:
        return []

    dash_ids = [r.resource_id for r in rows if r.resource_type == "dashboard"]
    ds_ids = [r.resource_id for r in rows if r.resource_type == "datasource"]
    dash_map: dict[str, tuple[str, str]] = {}
    if dash_ids:
        for did, name, owner in (
            await db.execute(
                select(Dashboard.id, Dashboard.name, Dashboard.user_id).where(Dashboard.id.in_(dash_ids))
            )
        ).all():
            dash_map[did] = (name, owner)
    ds_map: dict[str, tuple[str, str]] = {}
    if ds_ids:
        for did, name, owner in (
            await db.execute(
                select(DataSource.id, DataSource.name, DataSource.user_id).where(DataSource.id.in_(ds_ids))
            )
        ).all():
            ds_map[did] = (name, owner)

    out: list[dict] = []
    for r in rows:
        lookup = dash_map if r.resource_type == "dashboard" else ds_map
        info = lookup.get(r.resource_id)
        if info is None:
            continue  # dangling — resource was deleted
        name, owner_id = info
        out.append(
            {
                "id": r.id,
                "resource_type": r.resource_type,
                "resource_id": r.resource_id,
                "name": name,
                "permission": r.permission,
                "shared_by": r.shared_by,
                "owner_id": owner_id,
                "created_at": r.created_at,
            }
        )
    return out


async def dashboard_owner_for_viewer(
    db: AsyncSession, viewer_id: str, dashboard_id: str
) -> str | None:
    """Owner id of ``dashboard_id`` IFF it's shared to a workspace ``viewer_id``
    belongs to (and the viewer isn't the owner). Else ``None``.

    Drives the "render as owner" path: a member reads the owner's widgets/logs.
    """
    row = await db.execute(
        select(Dashboard.user_id)
        .select_from(WorkspaceResource)
        .join(WorkspaceMember, WorkspaceMember.workspace_id == WorkspaceResource.workspace_id)
        .join(Dashboard, Dashboard.id == WorkspaceResource.resource_id)
        .where(
            WorkspaceResource.resource_type == "dashboard",
            WorkspaceResource.resource_id == dashboard_id,
            WorkspaceMember.user_id == viewer_id,
            Dashboard.user_id != viewer_id,
        )
        .limit(1)
    )
    return row.scalar_one_or_none()


async def datasource_shared_to_member(
    db: AsyncSession, viewer_id: str, datasource_id: str
) -> bool:
    """True if ``datasource_id`` is shared to a workspace ``viewer_id`` belongs to
    and the viewer isn't the owner (query-only access for members)."""
    row = await db.execute(
        select(WorkspaceResource.id)
        .select_from(WorkspaceResource)
        .join(WorkspaceMember, WorkspaceMember.workspace_id == WorkspaceResource.workspace_id)
        .join(DataSource, DataSource.id == WorkspaceResource.resource_id)
        .where(
            WorkspaceResource.resource_type == "datasource",
            WorkspaceResource.resource_id == datasource_id,
            WorkspaceMember.user_id == viewer_id,
            DataSource.user_id != viewer_id,
        )
        .limit(1)
    )
    return row.scalar_one_or_none() is not None


async def purge_for_resource(db: AsyncSession, resource_type: str, resource_id: str) -> None:
    """Delete any shares of a resource that is being deleted (avoids dangling rows)."""
    await db.execute(
        sa_delete(WorkspaceResource).where(
            WorkspaceResource.resource_type == resource_type,
            WorkspaceResource.resource_id == resource_id,
        )
    )
    # Caller owns the surrounding transaction / flush.
