"""BA Framework Studio lifecycle: generate → persist → list/get/delete."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai import ba_frameworks
from app.core.exceptions import NexusBIException, SchemaNotFoundError
from app.models.ba_artifact import BAArtifact
from app.schemas.ba import BAArtifactResponse

_TITLES = {"swot": "SWOT", "porter": "Porter 5 qüvvə", "bcg": "BCG matrisi", "bpmn": "Proses xəritəsi"}


def to_response(a: BAArtifact) -> BAArtifactResponse:
    return BAArtifactResponse(
        id=a.id,
        framework=a.framework,
        title=a.title,
        context=a.context,
        content=a.content or {},
        created_at=a.created_at,
    )


async def generate(
    db: AsyncSession, user_id: str, framework: str, title: str, context: str
) -> BAArtifact:
    gen = ba_frameworks.GENERATORS.get(framework)
    if gen is None:  # schema Literal already guards; keep the service safe standalone
        raise NexusBIException(f"Naməlum framework: {framework}")
    content = await gen(context)
    artifact = BAArtifact(
        user_id=user_id,
        framework=framework,
        title=(title or "").strip() or _TITLES.get(framework, framework.upper()),
        context=(context or "").strip(),
        content=content,
    )
    db.add(artifact)
    await db.flush()
    await db.refresh(artifact)
    return artifact


async def list_for_user(db: AsyncSession, user_id: str) -> list[BAArtifact]:
    res = await db.execute(
        select(BAArtifact)
        .where(BAArtifact.user_id == user_id)
        .order_by(BAArtifact.created_at.desc())
    )
    return list(res.scalars().all())


async def get(db: AsyncSession, user_id: str, artifact_id: str) -> BAArtifact:
    res = await db.execute(
        select(BAArtifact).where(
            BAArtifact.id == artifact_id, BAArtifact.user_id == user_id
        )
    )
    artifact = res.scalar_one_or_none()
    if artifact is None:
        raise SchemaNotFoundError("Artefakt tapılmadı.")
    return artifact


async def delete(db: AsyncSession, user_id: str, artifact_id: str) -> None:
    artifact = await get(db, user_id, artifact_id)
    await db.delete(artifact)
    await db.flush()
