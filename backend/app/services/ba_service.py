"""BA Framework Studio lifecycle: generate → persist → list/get/delete → promote."""
from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai import ba_bcg, ba_evidence, ba_frameworks
from app.core.exceptions import NexusBIException, SchemaNotFoundError
from app.core.logging import get_logger
from app.models.ba_artifact import BAArtifact
from app.models.decision import Decision
from app.schemas.ba import BAArtifactResponse
from app.schemas.decision import DecisionCreate
from app.services import datasource_service as ds_service
from app.services import decision_service
from app.services.cache_service import CacheService

_log = get_logger("nexusbi.ba")

_TITLES = {"swot": "SWOT", "porter": "Porter 5 qüvvə", "bcg": "BCG matrisi", "bpmn": "Proses xəritəsi"}

# Frameworks whose whole input IS the context text. BCG reads its numbers from the
# source instead, so an empty context is legitimate there. Mirrored in the frontend
# (BAStudioPage.CONTEXT_REQUIRED) — kept here because the copilot tool calls this
# service directly and would otherwise bypass the HTTP-layer check entirely.
_CONTEXT_REQUIRED = {"swot", "porter", "bpmn"}


def to_response(a: BAArtifact) -> BAArtifactResponse:
    return BAArtifactResponse(
        id=a.id,
        framework=a.framework,
        title=a.title,
        context=a.context,
        content=a.content or {},
        created_at=a.created_at,
        datasource_id=a.datasource_id,
    )


async def _source_label(
    db: AsyncSession, user_id: str, datasource_id: str | None, core: dict[str, Any] | None
) -> str | None:
    """Display name of the source the evidence came from. ``None`` for demo."""
    if datasource_id is None:
        return None
    if name := (core or {}).get("source_name"):  # BCG already profiled it
        return str(name)
    try:
        ds = await ds_service.get_datasource_for_user(db, user_id, datasource_id)
        return ds.name
    except Exception as exc:  # noqa: BLE001 — a label is not worth failing generation
        _log.warning("ba_source_label_failed", error=type(exc).__name__, detail=str(exc)[:200])
        return None


async def generate(
    db: AsyncSession,
    cache: CacheService,
    user_id: str,
    framework: str,
    title: str,
    context: str,
    datasource_id: str | None = None,
) -> BAArtifact:
    gen = ba_frameworks.GENERATORS.get(framework)
    if gen is None:  # schema Literal already guards; keep the service safe standalone
        raise NexusBIException(f"Naməlum framework: {framework}")
    context = (context or "").strip()
    if framework in _CONTEXT_REQUIRED and not context:
        raise NexusBIException("Bu çərçivə üçün biznes kontekstini yazın.")

    # BCG's numbers ARE the artifact, so it computes its matrix and reads its facts
    # off that one snapshot — a second read would be a different dataset. The other
    # frameworks get a fail-soft fact pack that only decorates them.
    core: dict[str, Any] | None = None
    if framework == "bcg":
        core = await ba_bcg.compute_bcg_core(db, user_id, datasource_id, cache)
        facts = ba_evidence.facts_from_bcg(core)
    else:
        facts = await ba_evidence.build_fact_pack(db, user_id, datasource_id, cache)

    content = await gen(context, facts, core)
    # Persisted so the artifact stays self-contained: the chips it renders are the
    # numbers it was actually built from, not a fresh (drifted) read.
    content["facts"] = facts
    # Provenance is snapshotted too. datasource_id is ON DELETE SET NULL, so once
    # the source is removed the FK alone would make this artifact indistinguishable
    # from a demo-built one — a lie about where its numbers came from.
    if source_name := await _source_label(db, user_id, datasource_id, core):
        content["source_name"] = source_name

    artifact = BAArtifact(
        user_id=user_id,
        framework=framework,
        title=(title or "").strip() or _TITLES.get(framework, framework.upper()),
        context=context,
        content=content,
        datasource_id=datasource_id,
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


# ─── action → decision ───

def _promote_insight(artifact: BAArtifact, action: dict[str, Any]) -> str:
    """Why this decision exists: the framework it came from and the numbers cited."""
    content = artifact.content or {}
    parts = [f"{_TITLES.get(artifact.framework, artifact.framework)}: {artifact.title}"]
    facts = [f for f in (content.get("facts") or []) if isinstance(f, dict)]
    if facts:
        parts.append(
            "Faktlar — "
            + "; ".join(
                f"{f.get('label') or f.get('kind')}: {f.get('value')}" for f in facts
            )
        )
    if advice := str(content.get("advice") or "").strip():
        parts.append(advice)
    return "\n".join(parts)[:4000]


async def promote(
    db: AsyncSession, cache: CacheService, user_id: str, artifact_id: str, action_index: int
) -> tuple[Decision, BAArtifact]:
    """Turn one prioritised action into a tracked Decision (idempotent).

    Re-promoting the same action returns the decision already linked to it, so a
    double click cannot fork the loop. A decision the user later deleted no longer
    resolves, so the stale link is replaced with a fresh decision.
    """
    artifact = await get(db, user_id, artifact_id)
    content = artifact.content or {}
    actions = [a for a in (content.get("actions") or []) if isinstance(a, dict)]
    if action_index >= len(actions):
        raise SchemaNotFoundError("Bu addım artefaktda yoxdur.")
    action = actions[action_index]

    if existing_id := action.get("decision_id"):
        try:
            return await decision_service.get(db, user_id, str(existing_id)), artifact
        except SchemaNotFoundError:
            pass  # user deleted it — fall through and create a new one

    text = str(action.get("text") or "").strip()
    direction = str(action.get("direction") or "") or None
    decision = await decision_service.create(
        db,
        cache,
        user_id,
        DecisionCreate(
            # DecisionCreate.title has min_length=1, so an empty action text would
            # 422 inside the service rather than at the API boundary.
            title=(text or f"{artifact.title} — {action_index + 1}")[:255],
            insight=_promote_insight(artifact, action),
            action=text,
            metric_query=str(action.get("metric_hint") or "") or None,
            datasource_id=artifact.datasource_id,
            predicted_direction=direction if direction in ("increase", "decrease") else None,
            # Left off deliberately: re-measurement cadence is the user's call in
            # /decisions, not something promoting an action should switch on.
            measure_cadence="off",
        ),
    )

    # `content` is a plain JSON column (not MutableDict): SQLAlchemy does not see
    # nested in-place mutation, so the whole dict is REASSIGNED. Mutating
    # actions[i] in place here would emit no UPDATE and the idempotency above
    # would silently stop working after the session ends.
    new_actions = list(actions)
    new_actions[action_index] = {**action, "decision_id": decision.id}
    artifact.content = {**content, "actions": new_actions}
    await db.flush()
    return decision, artifact
