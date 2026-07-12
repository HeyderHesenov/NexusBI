"""Team workspaces + role-based membership (RBAC)."""
from __future__ import annotations

from sqlalchemy import delete as sa_delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ForbiddenError, SchemaNotFoundError
from app.models.user import User
from app.models.workspace import ROLES, Workspace, WorkspaceMember


def _rank(role: str) -> int:
    return ROLES.index(role) if role in ROLES else -1


async def create(db: AsyncSession, owner_id: str, name: str) -> Workspace:
    ws = Workspace(owner_id=owner_id, name=name)
    db.add(ws)
    await db.flush()
    # The creator is an owner-role member.
    db.add(WorkspaceMember(workspace_id=ws.id, user_id=owner_id, role="owner"))
    await db.flush()
    await db.refresh(ws)
    return ws


async def list_mine(db: AsyncSession, user_id: str) -> list[Workspace]:
    res = await db.execute(
        select(Workspace)
        .join(WorkspaceMember, WorkspaceMember.workspace_id == Workspace.id)
        .where(WorkspaceMember.user_id == user_id)
        .order_by(Workspace.created_at.desc())
    )
    return list(res.scalars().unique().all())


async def get_role(db: AsyncSession, workspace_id: str, user_id: str) -> str | None:
    res = await db.execute(
        select(WorkspaceMember.role).where(
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.user_id == user_id,
        )
    )
    return res.scalar_one_or_none()


async def require_role(
    db: AsyncSession, workspace_id: str, user_id: str, min_role: str
) -> str:
    """Ensure the user is a member with at least ``min_role``; else 403/404."""
    role = await get_role(db, workspace_id, user_id)
    if role is None:
        raise SchemaNotFoundError("İş sahəsi tapılmadı.")
    if _rank(role) < _rank(min_role):
        raise ForbiddenError("Bu əməliyyat üçün icazən yoxdur.")
    return role


async def rename(db: AsyncSession, workspace_id: str, actor_id: str, name: str) -> Workspace:
    """Rename a workspace (owner only)."""
    await require_role(db, workspace_id, actor_id, "owner")
    ws = (
        await db.execute(select(Workspace).where(Workspace.id == workspace_id))
    ).scalar_one_or_none()
    if ws is None:
        raise SchemaNotFoundError("İş sahəsi tapılmadı.")
    ws.name = name.strip()[:255]
    await db.flush()
    await db.refresh(ws)
    return ws


async def change_role(
    db: AsyncSession, workspace_id: str, actor_id: str, member_id: str, role: str
) -> WorkspaceMember:
    """Set a member's role directly (owner only).

    Only ``viewer``/``editor`` may be set here — promoting to ``owner`` is the job
    of ``transfer_ownership`` (which also demotes the previous owner) so there is
    always exactly one owner. The workspace owner can't be demoted this way either
    (avoids self-lockout); ownership only moves via transfer.
    """
    await require_role(db, workspace_id, actor_id, "owner")
    if role not in ("viewer", "editor"):
        raise ForbiddenError("Bu rol yalnız sahiblik ötürülməsi ilə təyin edilə bilər.")
    member = (
        await db.execute(
            select(WorkspaceMember).where(
                WorkspaceMember.id == member_id,
                WorkspaceMember.workspace_id == workspace_id,
            )
        )
    ).scalar_one_or_none()
    if member is None:
        raise SchemaNotFoundError("Üzv tapılmadı.")
    ws = (
        await db.execute(select(Workspace).where(Workspace.id == workspace_id))
    ).scalar_one_or_none()
    if ws and member.user_id == ws.owner_id:
        raise ForbiddenError("İş sahəsinin sahibinin rolu bu yolla dəyişdirilə bilməz.")
    member.role = role
    await db.flush()
    await db.refresh(member)
    return member


async def transfer_ownership(
    db: AsyncSession, workspace_id: str, actor_id: str, new_owner_member_id: str
) -> str:
    """Transfer ownership to another member (owner only).

    The target member becomes ``owner`` and the previous owner is demoted to
    ``editor`` — leaving exactly one owner. Returns the new owner's ``user_id``
    (so the audit entry records a user id, like the other workspace actions).
    """
    await require_role(db, workspace_id, actor_id, "owner")
    ws = (
        await db.execute(select(Workspace).where(Workspace.id == workspace_id))
    ).scalar_one_or_none()
    if ws is None:
        raise SchemaNotFoundError("İş sahəsi tapılmadı.")
    target = (
        await db.execute(
            select(WorkspaceMember).where(
                WorkspaceMember.id == new_owner_member_id,
                WorkspaceMember.workspace_id == workspace_id,
            )
        )
    ).scalar_one_or_none()
    if target is None:
        raise SchemaNotFoundError("Üzv tapılmadı.")
    if target.user_id == ws.owner_id:
        raise ForbiddenError("Bu üzv artıq sahibdir.")
    # Demote the current owner's membership to editor.
    old_owner = (
        await db.execute(
            select(WorkspaceMember).where(
                WorkspaceMember.workspace_id == workspace_id,
                WorkspaceMember.user_id == ws.owner_id,
            )
        )
    ).scalar_one_or_none()
    if old_owner is not None:
        old_owner.role = "editor"
    ws.owner_id = target.user_id
    target.role = "owner"
    await db.flush()
    return target.user_id


async def leave(db: AsyncSession, workspace_id: str, actor_id: str) -> None:
    """Remove yourself from a workspace (any non-owner member).

    The owner can't leave — they must transfer ownership or delete the workspace
    first (otherwise the workspace would be left ownerless).
    """
    await require_role(db, workspace_id, actor_id, "viewer")  # membership check
    ws = (
        await db.execute(select(Workspace).where(Workspace.id == workspace_id))
    ).scalar_one_or_none()
    if ws and actor_id == ws.owner_id:
        raise ForbiddenError(
            "İş sahəsinin sahibi çıxa bilməz — əvvəlcə sahibliyi ötür və ya sahəni sil."
        )
    await db.execute(
        sa_delete(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.user_id == actor_id,
        )
    )
    await db.flush()


async def delete(db: AsyncSession, workspace_id: str, actor_id: str) -> None:
    """Delete a workspace and all its memberships (owner only).

    Members are removed explicitly (not relying on DB-level FK cascade, which
    SQLite only honours with ``PRAGMA foreign_keys=ON``). RLS rules are keyed by
    datasource/user, not workspace, so they are untouched.
    """
    await require_role(db, workspace_id, actor_id, "owner")
    await db.execute(
        sa_delete(WorkspaceMember).where(WorkspaceMember.workspace_id == workspace_id)
    )
    await db.execute(sa_delete(Workspace).where(Workspace.id == workspace_id))
    await db.flush()


async def add_member(
    db: AsyncSession, workspace_id: str, actor_id: str, email: str, role: str
) -> WorkspaceMember:
    await require_role(db, workspace_id, actor_id, "owner")
    if role not in ROLES:
        role = "viewer"
    user = (
        await db.execute(select(User).where(User.email == email.strip().lower()))
    ).scalar_one_or_none()
    if user is None:
        raise SchemaNotFoundError("Bu e-poçtla istifadəçi tapılmadı.")
    # The workspace owner can't be demoted below owner (avoids self-lockout).
    ws = (
        await db.execute(select(Workspace).where(Workspace.id == workspace_id))
    ).scalar_one_or_none()
    if ws and user.id == ws.owner_id:
        role = "owner"
    existing = await get_role(db, workspace_id, user.id)
    if existing is not None:
        # Update role instead of duplicating membership.
        member = (
            await db.execute(
                select(WorkspaceMember).where(
                    WorkspaceMember.workspace_id == workspace_id,
                    WorkspaceMember.user_id == user.id,
                )
            )
        ).scalar_one()
        member.role = role
        await db.flush()
        return member
    member = WorkspaceMember(workspace_id=workspace_id, user_id=user.id, role=role)
    db.add(member)
    await db.flush()
    await db.refresh(member)
    return member


async def list_members(
    db: AsyncSession, workspace_id: str, user_id: str
) -> list[dict]:
    await require_role(db, workspace_id, user_id, "viewer")
    res = await db.execute(
        select(WorkspaceMember, User.email)
        .join(User, User.id == WorkspaceMember.user_id)
        .where(WorkspaceMember.workspace_id == workspace_id)
        .order_by(WorkspaceMember.created_at)
    )
    return [
        {"id": m.id, "user_id": m.user_id, "email": email, "role": m.role}
        for m, email in res.all()
    ]


async def remove_member(
    db: AsyncSession, workspace_id: str, actor_id: str, member_id: str
) -> None:
    await require_role(db, workspace_id, actor_id, "owner")
    member = (
        await db.execute(
            select(WorkspaceMember).where(
                WorkspaceMember.id == member_id,
                WorkspaceMember.workspace_id == workspace_id,
            )
        )
    ).scalar_one_or_none()
    if member is None:
        raise SchemaNotFoundError("Üzv tapılmadı.")
    ws = (
        await db.execute(select(Workspace).where(Workspace.id == workspace_id))
    ).scalar_one_or_none()
    if ws and member.user_id == ws.owner_id:
        raise ForbiddenError("İş sahəsinin sahibini çıxarmaq olmaz.")
    await db.delete(member)
    await db.flush()
