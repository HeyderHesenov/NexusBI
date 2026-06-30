"""Insight engine — automated discovery. Unlike insight_service/digest (per-query,
change-vs-previous, one LLM line), this systematically scans recent results for
notable patterns (dominance, concentration, outliers), SCORES them by impact, ranks,
dedups, and persists the top findings. Deterministic (stats), no AI.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai import analysis
from app.core.exceptions import AIGenerationError
from app.models.insight import Insight
from app.services import insight_service, stats
from app.services.tabular import is_num

TOP_K = 10
SCAN_LIMIT = 40


def _pairs(columns: list[str], rows: list[dict]) -> tuple[str, str, list[tuple[str, float]]]:
    label_col, value_col = analysis.pick_series(columns, rows)
    pairs = [
        (str(r.get(label_col)), float(r[value_col]))
        for r in rows
        if is_num(r.get(value_col))
    ]
    return label_col, value_col, pairs


def _candidates(nl: str, columns: list[str], rows: list[dict], qid: str | None) -> list[dict]:
    """Pure candidate generation from one result set."""
    try:
        _label_col, value_col, pairs = _pairs(columns, rows)
    except AIGenerationError:
        return []
    if len(pairs) < 3:
        return []

    out: list[dict] = []
    values = [v for _, v in pairs]
    total = sum(abs(v) for v in values) or 1.0
    ordered = sorted(pairs, key=lambda p: abs(p[1]), reverse=True)

    # 1) Dominance — one segment is a large share of the total.
    top_label, top_val = ordered[0]
    share = abs(top_val) / total
    if share >= 0.4:
        out.append({
            "kind": "dominance", "impact_score": round(min(1.0, share), 3),
            "title": f"«{top_label}» dominantdır",
            "body": f"{top_label} {value_col} cəminin {share * 100:.0f}%-ni təşkil edir.",
            "dedup_key": f"dominance|{nl[:60]}|{top_label}", "query_log_id": qid,
        })

    # 2) Concentration — the top few segments hold almost everything.
    if len(ordered) >= 6:
        top3 = sum(abs(v) for _, v in ordered[:3]) / total
        if top3 >= 0.75:
            out.append({
                "kind": "concentration", "impact_score": round(min(1.0, top3), 3),
                "title": "Yüksək konsentrasiya",
                "body": f"İlk 3 seqment {value_col} cəminin {top3 * 100:.0f}%-ni tutur ({len(ordered)} seqmentdən).",
                "dedup_key": f"concentration|{nl[:60]}", "query_log_id": qid,
            })

    # 3) Outliers — statistically extreme points (robust MAD z-score).
    idx = stats.zscore_outliers(values)
    median = sorted(values)[len(values) // 2]
    base = abs(median) or 1.0
    for i in idx[:2]:
        label, val = pairs[i]
        impact = round(min(1.0, abs(val - median) / base / 5), 3)
        out.append({
            "kind": "outlier", "impact_score": max(0.3, impact),
            "title": f"Anomaliya: {label}",
            "body": f"{label} ({value_col}={val:g}) qalan seqmentlərdən statistik kənardır.",
            "dedup_key": f"outlier|{nl[:60]}|{label}", "query_log_id": qid,
        })
    return out


async def scan(db: AsyncSession, user_id: str, top_k: int = TOP_K) -> list[Insight]:
    """Scan recent results, rank candidates by impact, persist NEW top-k insights."""
    history = await insight_service.scan_recent_distinct(db, user_id, SCAN_LIMIT)
    candidates: list[dict] = []
    for nl, rows in history:
        cols = list(rows[0].keys()) if rows else []
        candidates.extend(_candidates(nl, cols, rows, None))

    candidates.sort(key=lambda c: c["impact_score"], reverse=True)

    # Dedup within this batch and against already-stored keys.
    existing = set(
        (await db.execute(select(Insight.dedup_key).where(Insight.user_id == user_id))).scalars().all()
    )
    created: list[Insight] = []
    seen: set[str] = set()
    for c in candidates:
        key = c["dedup_key"]
        if key in existing or key in seen:
            continue
        seen.add(key)
        ins = Insight(user_id=user_id, **c)
        db.add(ins)
        created.append(ins)
        if len(created) >= top_k:
            break
    await db.flush()
    for ins in created:
        await db.refresh(ins)
    return created


async def list_for(db: AsyncSession, user_id: str, include_dismissed: bool = False) -> list[Insight]:
    q = select(Insight).where(Insight.user_id == user_id)
    if not include_dismissed:
        q = q.where(Insight.dismissed.is_(False))
    q = q.order_by(Insight.impact_score.desc(), Insight.created_at.desc())
    return list((await db.execute(q)).scalars().all())


async def dismiss(db: AsyncSession, user_id: str, insight_id: str) -> None:
    res = await db.execute(
        select(Insight).where(Insight.id == insight_id, Insight.user_id == user_id)
    )
    ins = res.scalar_one_or_none()
    if ins is not None:
        ins.dismissed = True
        await db.flush()
