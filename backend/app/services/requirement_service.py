"""RequirementDoc lifecycle: extract KPIs, then build a dashboard from them."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai import requirements
from app.config import settings
from app.core.exceptions import SchemaNotFoundError
from app.models.dashboard import Dashboard
from app.models.decision import Decision
from app.models.requirement import RequirementDoc
from app.schemas.decision import DecisionCreate
from app.schemas.requirement import (
    KpiItem,
    RequirementPromoteRequest,
    RequirementResponse,
)
from app.services import dashboard_service
from app.services import datasource_service as ds_service
from app.services import decision_service
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


def _promote_insight(doc: RequirementDoc, kpi: dict) -> str:
    """Why this decision exists, traced back to the sentence that asked for it."""
    parts = [f"Tələb sənədi: {doc.name}".strip()]
    if ref := str(kpi.get("requirement_ref") or "").strip():
        parts.append(f"İstinad: {ref}")
    if rationale := str(kpi.get("rationale") or "").strip():
        parts.append(rationale)
    return "\n".join(parts)[:4000]


async def promote_kpi(
    db: AsyncSession,
    cache: CacheService,
    user_id: str,
    doc_id: str,
    payload: RequirementPromoteRequest,
) -> tuple[Decision, RequirementDoc]:
    """Turn one extracted KPI into a tracked Decision (idempotent per KPI).

    Re-promoting the same KPI returns the decision already linked to it, so a
    double click cannot fork the loop. A decision the user later deleted no
    longer resolves, so the stale link is replaced with a fresh decision.
    """
    doc = await get(db, user_id, doc_id)  # 404s another user's document
    kpis = [k for k in (doc.extracted_kpis or []) if isinstance(k, dict)]
    if payload.kpi_index >= len(kpis):
        raise SchemaNotFoundError("Bu KPI sənəddə yoxdur.")
    kpi = kpis[payload.kpi_index]

    if existing_id := kpi.get("decision_id"):
        try:
            # User-scoped on purpose: decision_id comes out of a JSON blob and is
            # exactly as untrusted as any client input, so an unscoped db.get
            # here would hand back another user's decision (the IDOR that
            # _capture_baseline's comment describes for query_log_id).
            return await decision_service.get(db, user_id, str(existing_id)), doc
        except SchemaNotFoundError:
            pass  # user deleted it — fall through and create a new one

    if payload.datasource_id:
        # Validate BEFORE creating. _capture_baseline swallows a failed metric run
        # (decision_service.py:235-237), so a dead or foreign id would otherwise
        # return 201 with a permanently unmeasurable KPI instead of an error.
        await ds_service.get_datasource_for_user(db, user_id, payload.datasource_id)

    question = str(kpi.get("question") or "").strip()
    decision = await decision_service.create(
        db,
        cache,
        user_id,
        DecisionCreate(
            # DecisionCreate.title has min_length=1, so a KPI with a blank name
            # would 422 inside the service rather than at the API boundary.
            title=(str(kpi.get("name") or "").strip() or question
                   or f"KPI {payload.kpi_index + 1}")[:255],
            insight=_promote_insight(doc, kpi),
            action=question[:4000],
            # The KPI's analytic question IS the metric query — that is the whole
            # reason this maps onto Decision rather than onto KPITarget.
            metric_query=question or None,
            datasource_id=payload.datasource_id,
            predicted_value=payload.target_value,
            predicted_direction=payload.direction,
            # Left off deliberately, as in ba_service.promote: re-measurement
            # cadence is the user's call in /decisions. It matters more here —
            # a baseline that failed leaves last_query_log_id null, and a
            # scheduled tick runs with allow_ai_fallback=False, so a defaulted
            # cadence would tick forever while measuring nothing.
            measure_cadence="off",
        ),
    )

    # `extracted_kpis` is a plain JSON column (not MutableList): SQLAlchemy does
    # not see nested in-place mutation, so the whole list is REASSIGNED. Mutating
    # kpis[i] in place here would emit no UPDATE and the idempotency above would
    # silently stop working after the session ends.
    new_kpis = list(kpis)
    new_kpis[payload.kpi_index] = {**kpi, "decision_id": decision.id}
    doc.extracted_kpis = new_kpis
    await db.flush()
    return decision, doc


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
