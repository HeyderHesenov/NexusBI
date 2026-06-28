"""RequirementDoc lifecycle: extract KPIs, then build a dashboard from them."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai import requirements
from app.config import settings
from app.core.exceptions import SchemaNotFoundError
from app.models.dashboard import Dashboard
from app.models.requirement import RequirementDoc
from app.schemas.requirement import KpiItem, RequirementResponse
from app.services import dashboard_service
from app.services.cache_service import CacheService


def _derive_name(text: str) -> str:
    first = (text or "").strip().splitlines()[0] if text.strip() else "Tələb sənədi"
    return first[:80] or "Tələb sənədi"


def to_response(doc: RequirementDoc) -> RequirementResponse:
    kpis = [KpiItem(**k) for k in (doc.extracted_kpis or []) if isinstance(k, dict)]
    return RequirementResponse(
        id=doc.id,
        name=doc.name,
        kpis=kpis,
        dashboard_id=doc.dashboard_id,
        created_at=doc.created_at,
    )


async def extract_and_save(
    db: AsyncSession, user_id: str, name: str, text: str
) -> RequirementDoc:
    data = await requirements.extract_kpis(text)
    doc = RequirementDoc(
        user_id=user_id,
        name=(name or "").strip() or _derive_name(text),
        raw_text=text,
        extracted_kpis=data.get("kpis", []),
    )
    db.add(doc)
    await db.flush()
    await db.refresh(doc)
    return doc


async def list_for_user(db: AsyncSession, user_id: str) -> list[RequirementDoc]:
    res = await db.execute(
        select(RequirementDoc)
        .where(RequirementDoc.user_id == user_id)
        .order_by(RequirementDoc.created_at.desc())
    )
    return list(res.scalars().all())


async def get(db: AsyncSession, user_id: str, doc_id: str) -> RequirementDoc:
    res = await db.execute(
        select(RequirementDoc).where(
            RequirementDoc.id == doc_id, RequirementDoc.user_id == user_id
        )
    )
    doc = res.scalar_one_or_none()
    if doc is None:
        raise SchemaNotFoundError("Tələb sənədi tapılmadı.")
    return doc


async def build(
    db: AsyncSession,
    cache: CacheService,
    user_id: str,
    doc_id: str,
    datasource_id: str | None,
    questions: list[str] | None = None,
) -> Dashboard:
    """Build a dashboard from the doc's KPI questions (or a provided subset)."""
    doc = await get(db, user_id, doc_id)
    kpis = doc.extracted_kpis or []
    qs = questions or [
        k["question"] for k in kpis if isinstance(k, dict) and k.get("question")
    ]
    qs = [q for q in qs if q and q.strip()]
    if not qs:
        raise SchemaNotFoundError("Tələbdən KPI sualı çıxarılmadı.")
    name = doc.name or "Tələb paneli"
    # On SQLite, release this session's read transaction BEFORE the fan-out:
    # assemble runs widget queries in their own concurrent sessions and a held
    # read lock here would deadlock those writers. On server DBs (MVCC) this is
    # unnecessary and would needlessly split the request's atomicity, so skip it.
    if settings.DATABASE_URL.startswith("sqlite"):
        await db.commit()
    dash = await dashboard_service.assemble_dashboard(
        db, cache, user_id, name, f"Tələbdən yaradıldı: {name}", qs, datasource_id
    )
    doc.dashboard_id = dash.id
    await db.flush()
    return dash
