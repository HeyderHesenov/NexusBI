"""RequirementDoc lifecycle: extract KPIs, then build a dashboard from them."""
from __future__ import annotations

from collections.abc import Mapping, Sequence

from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai import requirements
from app.config import settings
from app.core.exceptions import SchemaNotFoundError
from app.core.logging import get_logger
from app.models.dashboard import Dashboard
from app.models.decision import Decision, DecisionMeasurement
from app.models.requirement import RequirementDoc
from app.schemas.decision import DecisionCreate
from app.schemas.requirement import (
    KpiItem,
    KpiOutcome,
    RequirementPromoteRequest,
    RequirementResponse,
)
from app.services import dashboard_service
from app.services import datasource_service as ds_service
from app.services import decision_service
from app.services.cache_service import CacheService

_log = get_logger("nexusbi.requirements")


def _derive_name(text: str) -> str:
    first = (text or "").strip().splitlines()[0] if text.strip() else "Tələb sənədi"
    return first[:80] or "Tələb sənədi"


# Only these reach KpiItem from the stored JSON. A whitelist rather than **k so
# that a rogue key in a legacy row — "outcome" above all, which is joined at read
# time and never stored — cannot reach validation and 500 the whole list.
_PERSISTED_KPI_FIELDS = (
    "name", "question", "rationale", "requirement_ref",
    "target_value", "direction", "decision_id",
)
# The subset that cannot fail validation (plain strings), so a KPI with a corrupt
# target still renders its question and its link rather than vanishing.
_ALWAYS_PARSEABLE = ("name", "question", "rationale", "requirement_ref")


def to_response(
    doc: RequirementDoc, outcomes: Mapping[str, KpiOutcome] | None = None
) -> RequirementResponse:
    """Map a document to the wire. ``outcomes`` is optional because extraction has
    no decisions yet and must not pay for a join to learn that."""
    kpis: list[KpiItem] = []
    for raw in doc.extracted_kpis or []:
        if not isinstance(raw, dict):
            continue
        fields = {f: raw[f] for f in _PERSISTED_KPI_FIELDS if raw.get(f) is not None}
        try:
            item = KpiItem(**fields)
        except ValidationError:
            # A row written before the coercers shipped, restored from a backup or
            # hand-edited can hold direction="up" or target_value="15%", and
            # KpiItem's Literal/float would reject it. Dropping the unparseable
            # FIELDS costs one pre-fill; letting the error escape 500s every
            # document the user owns, which is a far worse answer to bad data.
            _log.warning("requirement_kpi_unparseable", doc_id=doc.id, fields=sorted(fields))
            item = KpiItem(**{f: v for f, v in fields.items() if f in _ALWAYS_PARSEABLE})
        if outcomes and item.decision_id:
            item.outcome = outcomes.get(item.decision_id)
        kpis.append(item)
    return RequirementResponse(
        id=doc.id,
        name=doc.name,
        kpis=kpis,
        dashboard_id=doc.dashboard_id,
        created_at=doc.created_at,
    )


def _linked_decision_ids(docs: Sequence[RequirementDoc]) -> set[str]:
    return {
        str(k["decision_id"])
        for doc in docs
        for k in (doc.extracted_kpis or [])
        if isinstance(k, dict) and k.get("decision_id")
    }


async def _outcomes_for(
    db: AsyncSession, user_id: str, decision_ids: set[str]
) -> dict[str, KpiOutcome]:
    """Load every linked decision and its latest measurement in two queries.

    Two, not two-per-document: a requirements list holding N documents must not
    grow N round trips, so the ids are collected across all of them first.
    """
    if not decision_ids:
        return {}

    # The ownership gate. decision_id comes out of a JSON blob, so a document
    # carrying someone else's id — restored from a backup, copied, or crafted —
    # would otherwise render that user's numbers. Everything downstream keys off
    # this result, which is why the second query needs no scope of its own.
    owned = {
        d.id: d
        for d in (
            await db.execute(
                select(Decision).where(
                    Decision.id.in_(decision_ids), Decision.user_id == user_id
                )
            )
        ).scalars()
    }
    if not owned:
        return {}

    # Latest measurement per decision. The id tie-break is load-bearing: a
    # baseline and a same-instant re-measure would otherwise order arbitrarily
    # and the freshness reported would flip between runs.
    rn = (
        func.row_number()
        .over(
            partition_by=DecisionMeasurement.decision_id,
            order_by=(
                DecisionMeasurement.measured_at.desc(),
                DecisionMeasurement.id.desc(),
            ),
        )
        .label("rn")
    )
    ranked = (
        select(DecisionMeasurement.id, rn)
        .where(DecisionMeasurement.decision_id.in_(list(owned)))
        .subquery()
    )
    latest = {
        m.decision_id: m
        for m in (
            await db.execute(
                select(DecisionMeasurement).where(
                    DecisionMeasurement.id.in_(
                        select(ranked.c.id).where(ranked.c.rn == 1)
                    )
                )
            )
        ).scalars()
    }

    out: dict[str, KpiOutcome] = {}
    for did, d in owned.items():
        m = latest.get(did)
        out[did] = KpiOutcome(
            decision_id=did,
            impact_status=d.impact_status,
            baseline_value=d.baseline_value,
            predicted_value=d.predicted_value,
            predicted_direction=d.predicted_direction,
            realized_value=d.realized_value,
            measured_at=m.measured_at if m else None,
            # Deliberately no `or measured_at` fallback: an unknown age renders
            # as no caption at all, which is honest, whereas a borrowed stamp
            # would report a stale number as fresh.
            data_as_of=m.data_as_of if m else None,
        )
    return out


async def response_for(
    db: AsyncSession, user_id: str, doc: RequirementDoc
) -> RequirementResponse:
    """One already-loaded document, with its KPIs' outcomes joined."""
    return to_response(doc, await _outcomes_for(db, user_id, _linked_decision_ids([doc])))


async def list_response(db: AsyncSession, user_id: str) -> list[RequirementResponse]:
    docs = await list_for_user(db, user_id)
    outcomes = await _outcomes_for(db, user_id, _linked_decision_ids(docs))
    return [to_response(d, outcomes) for d in docs]


async def get_response(
    db: AsyncSession, user_id: str, doc_id: str
) -> RequirementResponse:
    return await response_for(db, user_id, await get(db, user_id, doc_id))


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
    stored = list(doc.extracted_kpis or [])
    # Index into the ORIGINAL list. Rewriting the column from a dict-filtered copy
    # would delete any non-dict entry (a legacy row, a half-migrated import) the
    # first time any KPI in the document is promoted — a read path's defensive
    # filter turned into a destructive write.
    positions = [i for i, k in enumerate(stored) if isinstance(k, dict)]
    if payload.kpi_index >= len(positions):
        raise SchemaNotFoundError("Bu KPI sənəddə yoxdur.")
    slot = positions[payload.kpi_index]
    kpi = stored[slot]

    if existing_id := kpi.get("decision_id"):
        try:
            # User-scoped on purpose: decision_id comes out of a JSON blob and is
            # exactly as untrusted as any client input, so an unscoped db.get
            # here would hand back another user's decision (the IDOR that
            # _capture_baseline's comment describes for query_log_id).
            existing = await decision_service.get(db, user_id, str(existing_id))
        except SchemaNotFoundError:
            pass  # user deleted it — fall through and create a new one
        else:
            if existing.baseline_value is not None:
                return existing, doc
            # Linked, but the baseline capture failed (_capture_baseline logs and
            # returns early), which leaves the KPI permanently unmeasurable:
            # measure() only sets realized_value, and _compute_impact_status stays
            # "pending" forever while baseline_value is None. Returning here would
            # make "check the source" advice the user cannot act on, so a repeat
            # promote RETRIES the capture — and may rebind the source and target.
            if payload.datasource_id:
                await ds_service.get_datasource_for_user(db, user_id, payload.datasource_id)
                existing.datasource_id = payload.datasource_id
            existing.predicted_value = payload.target_value
            existing.predicted_direction = payload.direction
            await decision_service.recapture_baseline(db, cache, existing)
            return existing, doc

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
    new_kpis = list(stored)
    new_kpis[slot] = {**kpi, "decision_id": decision.id}
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
