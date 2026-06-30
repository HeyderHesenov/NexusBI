"""A/B experiment CRUD + significance analysis (reuses app.services.stats)."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NexusBIException, SchemaNotFoundError
from app.models.experiment import Experiment
from app.services import stats


async def create(db: AsyncSession, user_id: str, payload) -> Experiment:
    exp = Experiment(
        user_id=user_id, name=payload.name, kind=payload.kind,
        a_label=payload.a_label, b_label=payload.b_label,
        data=payload.data, notes=payload.notes,
    )
    db.add(exp)
    await db.flush()
    await db.refresh(exp)
    return exp


async def list_for(db: AsyncSession, user_id: str) -> list[Experiment]:
    res = await db.execute(
        select(Experiment).where(Experiment.user_id == user_id).order_by(Experiment.created_at.desc())
    )
    return list(res.scalars().all())


async def get(db: AsyncSession, user_id: str, experiment_id: str) -> Experiment:
    res = await db.execute(
        select(Experiment).where(Experiment.id == experiment_id, Experiment.user_id == user_id)
    )
    exp = res.scalar_one_or_none()
    if exp is None:
        raise SchemaNotFoundError("Eksperiment tapılmadı.")
    return exp


async def delete(db: AsyncSession, user_id: str, experiment_id: str) -> None:
    exp = await get(db, user_id, experiment_id)
    await db.delete(exp)
    await db.flush()


def _num(d: dict, key: str) -> float:
    v = d.get(key)
    if not isinstance(v, (int, float)) or isinstance(v, bool):
        raise NexusBIException(f"'{key}' ədəd olmalıdır.")
    return float(v)


def _count(d: dict, key: str) -> int:
    """A non-negative count (visitors / conversions) — a clear error before the stats run."""
    v = _num(d, key)
    if v < 0:
        raise NexusBIException(f"'{key}' mənfi ola bilməz.")
    return int(v)


def compute(exp: Experiment) -> dict:
    """Pure significance computation from the experiment's stored inputs."""
    a, b = exp.data.get("a", {}), exp.data.get("b", {})
    if exp.kind == "conversion":
        na, ca = _count(a, "n"), _count(a, "conversions")
        nb, cb = _count(b, "n"), _count(b, "conversions")
        if ca > na or cb > nb:
            raise NexusBIException("Konversiya sayı ziyarətçi sayından çox ola bilməz.")
        r = stats.two_proportion_ztest(ca, na, cb, nb)
        better = exp.b_label if r["p2"] > r["p1"] else exp.a_label
        min_n = min(na, nb)
        metric = {"a": round(r["p1"] * 100, 2), "b": round(r["p2"] * 100, 2), "unit": "%"}
    elif exp.kind == "mean":
        na, nb = _count(a, "n"), _count(b, "n")
        r = stats.welch_ttest_from_stats(
            _num(a, "mean"), _num(a, "sd"), na, _num(b, "mean"), _num(b, "sd"), nb
        )
        better = exp.b_label if r["diff"] > 0 else exp.a_label
        min_n = min(na, nb)
        metric = {"a": round(_num(a, "mean"), 3), "b": round(_num(b, "mean"), 3), "unit": ""}
    else:
        raise NexusBIException("Naməlum eksperiment tipi.")

    adequate, sample_msg = stats.sample_adequacy(min_n)
    if not r["significant"]:
        verdict = "Fərq statistik əhəmiyyətli deyil."
        if not adequate:
            verdict = f"Fərq əhəmiyyətli deyil — {sample_msg}"
    else:
        verdict = f"«{better}» statistik üstündür ({r['detail']})."
    return {
        "kind": exp.kind,
        "metric": metric,
        "p_value": round(r["p_value"], 4),
        "significant": r["significant"],
        "lift_pct": round(r.get("lift", 0.0) * 100, 1) if exp.kind == "conversion" else None,
        "diff": round(r.get("diff", 0.0), 4) if exp.kind == "mean" else None,
        "ci_low": round(r["ci_low"], 4),
        "ci_high": round(r["ci_high"], 4),
        "winner": better if r["significant"] else None,
        "verdict": verdict,
        "sample_note": sample_msg,
    }


async def analyze(db: AsyncSession, user_id: str, experiment_id: str) -> Experiment:
    exp = await get(db, user_id, experiment_id)
    exp.result = compute(exp)
    exp.status = "analyzed"
    await db.flush()
    await db.refresh(exp)
    return exp
