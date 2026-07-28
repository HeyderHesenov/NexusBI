"""Deterministic evidence for BA Studio: a fact pack plus the rules that read it.

BA Studio's frameworks used to be pure text→LLM→text, which made them the one
place in the app that broke the ``insight_facts`` rule: *the headline numbers are
math, not LLM prose*. This module supplies the math.

The key design choice is WHO gets to attach evidence. Asking the model to cite
fact ids per bullet is cheap to make well-formed and impossible to verify — it
can cite ``f3`` on a claim ``f3`` does not support, and the UI would then stamp a
"grounded" badge onto a hallucination. That is worse than no badge, because it
launders it. So the evidence channel is ``derive_items``: rules attach the fact
id, and every model-authored bullet is labelled a judgement instead. The pack is
still fed to the prompt, so AI prose is *informed* by the real numbers — it just
cannot claim attribution.

Fact shape: ``{id, kind, label, value, metric, source}`` where ``kind`` is one of
the chip kinds the frontend knows (total/top/trend/anomaly/concentration),
``source`` is human-readable provenance ("sales.revenue / sale_date") and
``metric`` is the bare measure column (used to seed a Decision's metric query).
"""
from __future__ import annotations

import asyncio
import re
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.ai import sql_guard
from app.config import settings
from app.core.logging import get_logger
from app.db import demo_data
from app.services import query_service, stats
from app.services.cache_service import CacheService
from app.services.explore_service import SourceProfile, profile_source, quote_ident
from app.services.insight_facts import compute_facts

_log = get_logger("nexusbi.ai")

_MAX_FACTS = 6
_PROBE_LIMIT = 200  # periods in the time series probe
_TOP_N = 10  # rows in the breakdown probe
# Top-1 revenue share at or above this is a dependency risk worth a SWOT threat.
_CONCENTRATION_HIGH = 40.0

# Kinds taken from the time-series probe. The series is complete (every period up
# to _PROBE_LIMIT), so its sum is the true grand total — the breakdown probe's sum
# is only its top-N slice and must never be presented as a total.
_SERIES_KINDS = ("total", "trend", "anomaly")

_PCT = re.compile(r"^([+-]?\d+(?:\.\d+)?)\s*%")


def _pct(value: object) -> float | None:
    """Leading percentage of a fact value ("+18%" → 18.0, "1.2K (47%)" → None)."""
    m = _PCT.match(str(value).strip())
    return float(m.group(1)) if m else None


# ─── probes ───

def _probe_sqls(p: SourceProfile) -> list[tuple[str, str, tuple[str, ...]]]:
    """``(source_label, SQL, kinds)`` probes composed from the profile.

    Deterministic and schema-sourced — identifiers come from the profile and are
    dialect-quoted, never interpolated from user text.
    """
    def q(ident: str) -> str:
        return quote_ident(ident, p.dialect)

    if not p.measures:
        return []
    m = p.measures[0]
    t = q(p.table)
    out: list[tuple[str, str, tuple[str, ...]]] = []

    if p.temporals:
        ts = p.temporals[0]
        out.append((
            f"{p.table}.{m} / {ts}",
            f"SELECT {q(ts)}, SUM({q(m)}) AS {q(m)} FROM {t} "
            f"GROUP BY {q(ts)} ORDER BY {q(ts)} LIMIT {_PROBE_LIMIT}",
            _SERIES_KINDS,
        ))
    if p.dims:
        d = p.dims[0]
        out.append((
            f"{p.table}.{m} / {d}",
            f"SELECT {q(d)}, SUM({q(m)}) AS {q(m)} FROM {t} "
            f"GROUP BY {q(d)} ORDER BY SUM({q(m)}) DESC LIMIT {_TOP_N}",
            (),  # composition facts are computed directly, not via compute_facts
        ))
    return out


async def _run_probes(
    db: AsyncSession,
    user_id: str,
    datasource_id: str | None,
    cache: CacheService,
    sqls: list[str],
) -> list[tuple[list[str], list[dict[str, Any]]] | None]:
    """Run every probe against ONE consistent read of the source."""
    if datasource_id is None:
        # Synthetic numbers must never be dressed up as a user's evidence outside
        # demo mode. execute_demo_snapshot does not check the flag itself (unlike
        # guarded_read), so the gate lives here.
        if not settings.DEMO_MODE:
            return [None] * len(sqls)
        # ONE seed for all probes: execute_demo_sql reseeds per call and the live
        # feed random-walks revenue between calls, so separate calls would put the
        # two probes on two different datasets.
        snaps = await asyncio.to_thread(demo_data.execute_demo_snapshot, sqls)
        # The snapshot returns rows only; dict key order is cursor order.
        return [(list(rows[0]), rows) if rows else None for rows in snaps]

    out: list[tuple[list[str], list[dict[str, Any]]] | None] = []
    for sql in sqls:
        try:
            clean = sql_guard.validate_select_only(sql)
            out.append(await query_service.guarded_read(clean, datasource_id, user_id, db, cache))
        except Exception as exc:  # noqa: BLE001 — one dead probe must not kill the pack
            _log.warning("ba_probe_failed", error=type(exc).__name__, detail=str(exc)[:200])
            out.append(None)
    return out


# ─── facts ───

def facts_from_result(
    source: str,
    metric: str,
    columns: list[str],
    rows: list[dict[str, Any]],
    kinds: tuple[str, ...],
) -> list[dict[str, Any]]:
    """Facts of the requested ``kinds`` from one probe result."""
    return [
        {**f, "metric": metric, "source": source}
        for f in compute_facts(columns, rows)
        if f["kind"] in kinds
    ]


def composition_facts(
    source: str,
    metric: str,
    columns: list[str],
    rows: list[dict[str, Any]],
    grand_total: float | None,
) -> list[dict[str, Any]]:
    """``top`` + ``concentration`` from the breakdown probe.

    Shares are taken against ``grand_total`` (the series probe's complete sum),
    NOT against the breakdown's own sum: the breakdown is a top-N slice, so
    dividing by its own total would overstate every share. When the breakdown
    came back short of the limit it *is* the whole picture and its own sum is the
    grand total; when it was truncated and no series total is available, the share
    is unknowable and no fact is emitted.
    """
    if len(rows) < 3 or len(columns) < 2:
        return []
    label_col, value_col = columns[0], columns[-1]
    pairs = [
        (str(r.get(label_col)), v)
        for r in rows
        if (v := stats.to_float(r.get(value_col))) is not None
    ]
    if not pairs:
        return []
    complete = len(rows) < _TOP_N
    total = sum(v for _, v in pairs) if complete else grand_total
    if not total or total <= 0:
        return []
    label, best = max(pairs, key=lambda t: t[1])
    pct = best / total * 100
    return [
        {
            "kind": "top", "label": label, "metric": metric, "source": source,
            "value": f"{stats.compact_number(best)} ({pct:.0f}%)",
        },
        {
            "kind": "concentration", "label": label, "metric": metric, "source": source,
            "value": f"{pct:.0f}%",
        },
    ]


def facts_from_bcg(core: dict[str, Any]) -> list[dict[str, Any]]:
    """Facts read off an already-computed BCG matrix.

    BCG never runs probes: it holds its own consistent snapshot, and a second read
    would be a *different* dataset (the demo feed drifts between reads), so the
    chips would contradict the bubbles they sit next to.
    """
    items = [i for i in (core.get("items") or []) if isinstance(i, dict)]
    if not items:
        return []
    source = f"{core.get('source_name') or 'Demo'} — portfel"
    metric = str(core.get("metric") or "")
    leader = max(items, key=lambda i: i.get("share_pct") or 0.0)
    grower = max(items, key=lambda i: i.get("growth_pct") or 0.0)
    facts = [
        {
            "kind": "concentration",
            "label": str(leader.get("label") or ""),
            "value": f"{leader.get('share_pct') or 0:.0f}%",
            "metric": metric,
            "source": source,
        },
        {
            "kind": "trend",
            "label": str(grower.get("label") or ""),
            "value": f"{grower.get('growth_pct') or 0:+.0f}%",
            "metric": metric,
            "source": source,
        },
    ]
    return _stamp_ids(facts)


def _stamp_ids(facts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Assign stable ``f1..fN`` ids and cap the pack."""
    capped = facts[:_MAX_FACTS]
    for i, f in enumerate(capped, 1):
        f["id"] = f"f{i}"
    return capped


async def build_fact_pack(
    db: AsyncSession, user_id: str, datasource_id: str | None, cache: CacheService
) -> list[dict[str, Any]]:
    """Deterministic facts about the source, or ``[]`` when none can be had.

    Fail-soft by design: the pack decorates a framework, so a source we cannot
    profile must degrade to today's behaviour rather than break generation. (BCG
    is the opposite case — there the numbers ARE the artifact — so it does not go
    through here.)
    """
    try:
        p = await profile_source(db, user_id, datasource_id, cache)
        probes = _probe_sqls(p)
        if not probes:
            return []
        results = await _run_probes(db, user_id, datasource_id, cache, [s for _, s, _ in probes])
        metric = p.measures[0]
        facts: list[dict[str, Any]] = []
        grand_total: float | None = None
        for (source, _, kinds), res in zip(probes, results):
            if not res:
                continue
            columns, rows = res
            if kinds:  # the time-series probe
                facts.extend(facts_from_result(source, metric, columns, rows, kinds))
                grand_total = sum(
                    v for r in rows if (v := stats.to_float(r.get(columns[-1]))) is not None
                )
            else:  # the breakdown probe — needs the series total to size its shares
                facts.extend(composition_facts(source, metric, columns, rows, grand_total))
        return _stamp_ids(facts)
    except Exception as exc:  # noqa: BLE001 — evidence is optional, generation is not
        _log.warning("ba_fact_pack_failed", error=type(exc).__name__, detail=str(exc)[:200])
        return []


# ─── rules over the facts ───

def _derived(text: str, fact_id: str) -> dict[str, Any]:
    return {"text": text[:300], "evidence": [fact_id] if fact_id else [], "derived": True}


def derive_items(facts: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    """SWOT bullets the facts themselves prove.

    This is the only place evidence ids get attached (see the module docstring).
    Only kinds with an unambiguous polarity are used: a ``top`` contributor is
    neither a strength nor a weakness, so it stays a chip and produces no bullet.
    """
    out: dict[str, list[dict[str, Any]]] = {
        "strengths": [], "weaknesses": [], "opportunities": [], "threats": [],
    }
    for f in facts:
        kind = f.get("kind")
        fid = str(f.get("id") or "")
        value = str(f.get("value") or "")
        label = str(f.get("label") or "")
        metric = str(f.get("metric") or "")
        if kind == "trend":
            pct = _pct(value)
            if pct is None:
                continue
            if pct == 0:
                continue
            # A labelled trend belongs to ONE dimension value (BCG's best grower),
            # so it must not be phrased as the whole metric's trend.
            subject = " ".join(p for p in (f"«{label}» üzrə" if label else "", metric) if p)
            prefix = f"Ölçülmüş {subject} trendi" if subject else "Ölçülmüş trend"
            verdict = "müsbətdir" if pct > 0 else "mənfidir"
            bucket = "strengths" if pct > 0 else "weaknesses"
            out[bucket].append(_derived(f"{prefix} {verdict}: {value}.", fid))
        elif kind == "concentration":
            pct = _pct(value)
            if pct is not None and pct >= _CONCENTRATION_HIGH and label:
                out["threats"].append(
                    _derived(f"Gəlirin {value}-i «{label}» üzərinə düşür — asılılıq riski.", fid)
                )
        elif kind == "anomaly":
            out["threats"].append(
                _derived(f"Seriyada {value} anomaliya nöqtəsi var — sabitlik riski.", fid)
            )
    return out


def _action(
    text: str, impact: int, effort: int, metric_hint: str, direction: str
) -> dict[str, Any]:
    return {
        "text": text[:300],
        "impact": impact,
        "effort": effort,
        "metric_hint": metric_hint[:300],
        "direction": direction,
        "derived": True,
    }


def derive_actions(
    facts: list[dict[str, Any]], framework: str, core: dict[str, Any] | None = None
) -> list[dict[str, Any]]:
    """Prioritised actions from the data alone — the offline/fallback path.

    Keeps the rule-based route useful rather than empty when there is no AI key,
    mirroring how ``_bcg_advice_rule_based`` keeps BCG advice useful.
    """
    out: list[dict[str, Any]] = []
    for f in facts:
        kind = f.get("kind")
        value = str(f.get("value") or "")
        label = str(f.get("label") or "")
        metric = str(f.get("metric") or "")
        hint = f"{metric} trendi" if metric else ""
        if kind == "trend" and (pct := _pct(value)) is not None and pct < 0:
            out.append(_action(
                f"Mənfi trendin ({value}) səbəbini araşdır və bərpa planı qur.",
                5, 3, hint, "increase",
            ))
        elif kind == "concentration" and (pct := _pct(value)) is not None:
            if pct >= _CONCENTRATION_HIGH and label:
                out.append(_action(
                    f"«{label}»-dan asılılığı azalt: gəlir bazasını genişləndir.",
                    4, 4, hint, "increase",
                ))
        elif kind == "anomaly":
            out.append(_action(
                f"{value} anomaliya nöqtəsini yoxla — data keyfiyyəti və ya real hadisə.",
                3, 2, hint, "increase",
            ))

    if framework == "bcg" and core:
        items = [i for i in (core.get("items") or []) if isinstance(i, dict)]
        metric = str(core.get("metric") or "")
        hint = f"{metric} trendi" if metric else ""

        def names(quadrant: str) -> str:
            return ", ".join(str(i.get("label")) for i in items if i.get("quadrant") == quadrant)

        if stars := names("star"):
            out.append(_action(f"Ulduzlara ({stars}) investisiyanı artır.", 5, 4, hint, "increase"))
        if dogs := names("dog"):
            out.append(_action(f"İtlər ({dogs}) üzrə xərcləri azalt.", 3, 2, hint, "decrease"))
        if questions := names("question"):
            out.append(_action(
                f"Sual işarələrini ({questions}) seçici test et.", 3, 3, hint, "increase"
            ))
    return out[:5]


def _metric_hint(facts: list[dict[str, Any]]) -> str:
    for f in facts:
        if metric := str(f.get("metric") or ""):
            return f"{metric} trendi"
    return ""


def derive_structural_actions(
    framework: str, content: dict[str, Any], facts: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Actions read off the framework's OWN output, as a last-resort backstop.

    Fact-derived actions only fire when the data says something actionable — a
    healthy trend and a spread-out portfolio legitimately produce none. Without
    this, a keyless SWOT/Porter/BPMN would render an empty action list and the
    whole framework → decision loop would be dead exactly on the offline path.
    A named weakness or a `high` force IS the thing to act on, so the structure is
    enough to propose one.
    """
    hint = _metric_hint(facts)
    out: list[dict[str, Any]] = []

    def first_text(bucket: str) -> str:
        for item in content.get(bucket) or []:
            text = str(item.get("text") if isinstance(item, dict) else item).strip()
            if text:
                return text
        return ""

    if framework == "swot":
        if weakness := first_text("weaknesses"):
            out.append(_action(f"Zəif tərəfi aradan qaldır: {weakness}", 4, 3, hint, "increase"))
        if threat := first_text("threats"):
            out.append(_action(f"Təhlükəyə qarşı plan qur: {threat}", 4, 3, hint, "increase"))
        if opportunity := first_text("opportunities"):
            out.append(_action(f"İmkanı sına: {opportunity}", 4, 4, hint, "increase"))
    elif framework == "porter":
        forces = [f for f in (content.get("forces") or []) if isinstance(f, dict)]
        high = [f for f in forces if f.get("level") == "high"]
        for force in high:
            out.append(_action(
                f"Yüksək qüvvəni zəiflət: {force.get('key')} — mövqeyi müdafiə et.",
                4, 3, hint, "increase",
            ))
        if forces and not high:
            # Nothing scored high, so there is no pressure to mitigate yet. The
            # honest next step is sharpening the assessment, not inventing one.
            out.append(_action(
                "Qüvvə qiymətləndirməsini gücləndir: rəqiblər və təchizat zənciri "
                "üzrə araşdırma apar.",
                3, 3, hint, "increase",
            ))
    elif framework == "bpmn":
        # Deliberately generic: the fallback's own summary text describes the
        # offline mode, not the process, so embedding it would read as noise.
        out.append(_action(
            "Prosesin dar boğazını müəyyən et və dövr müddətini ölçməyə başla.",
            4, 3, hint, "increase",
        ))
    return out[:5]
