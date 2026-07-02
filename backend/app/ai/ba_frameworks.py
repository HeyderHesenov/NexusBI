"""BA Framework Studio generators: SWOT, Porter 5 Forces, BCG matrix, BPMN.

Each generator is AI-first with a deterministic rule-based fallback (the
``root_cause`` pattern) so the studio works offline / keyless. BCG is the
inverse: the matrix itself is computed DETERMINISTICALLY from one demo-data
snapshot (share + H2-vs-H1 growth) and AI only writes the advice prose.

BPMN output is Mermaid code that ends up in the browser, so it passes a strict
server-side sanitizer regardless of where it came from.
"""
from __future__ import annotations

import asyncio
import json
import re
from typing import Any

from app.ai.client import chat_json
from app.ai.prompt_templates import (
    BCG_ADVICE_PROMPT,
    BCG_ADVICE_USER_PROMPT,
    BPMN_PROMPT,
    BPMN_USER_PROMPT,
    PORTER_PROMPT,
    PORTER_USER_PROMPT,
    SWOT_PROMPT,
    SWOT_USER_PROMPT,
)
from app.ai.textparse import clean, split_lines
from app.core.logging import get_logger
from app.db.demo_data import execute_demo_snapshot

_log = get_logger("nexusbi.ai")

_MAX_CONTEXT = 8000
_MAX_ITEMS = 6  # per SWOT bucket
_LEVELS = {"low", "medium", "high"}
PORTER_KEYS = ("rivalry", "new_entrants", "supplier_power", "buyer_power", "substitutes")

# Offline SWOT fallback: bucket context lines by AZ/EN/RU/TR keyword hints.
_SWOT_HINTS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("strengths", re.compile(r"güclü|üstünlük|strength|advantage|сильн|güçlü|avantaj", re.I)),
    ("weaknesses", re.compile(r"zəif|çatışmaz|problem|weak|слаб|zayıf|eksik", re.I)),
    ("opportunities", re.compile(r"imkan|potensial|artım|opportunit|growth|возможн|fırsat", re.I)),
    ("threats", re.compile(r"təhlük|risk|rəqib|threat|competitor|угроз|конкурент|tehdit|rakip", re.I)),
)


def _clean(text: str) -> str:
    return clean(text, _MAX_CONTEXT)


def _str_list(v: Any, cap: int = _MAX_ITEMS) -> list[str]:
    if not isinstance(v, list):
        return []
    return [str(x).strip()[:300] for x in v if str(x).strip()][:cap]


# ─── SWOT ───

def _swot_rule_based(context: str) -> dict[str, Any]:
    buckets: dict[str, list[str]] = {
        "strengths": [], "weaknesses": [], "opportunities": [], "threats": [],
    }
    for line in split_lines(context):
        for key, hint in _SWOT_HINTS:
            if hint.search(line):
                if len(buckets[key]) < _MAX_ITEMS:
                    buckets[key].append(line)
                break
    return {
        **buckets,
        "advice": (
            "Oflayn qayda-əsaslı təhlil: bəndlər kontekst mətnindəki açar sözlərə görə "
            "qruplaşdırılıb. Dərin SWOT üçün AI açarı tələb olunur."
        ),
    }


async def swot(context: str) -> dict[str, Any]:
    cleaned = _clean(context)
    try:
        raw = await chat_json(
            SWOT_PROMPT, SWOT_USER_PROMPT.format(context=cleaned), localize=True
        )
        out = {k: _str_list(raw.get(k)) for k in ("strengths", "weaknesses", "opportunities", "threats")}
        if any(out.values()):
            out["advice"] = str(raw.get("advice") or "")[:1000]
            return out
    except Exception as exc:  # noqa: BLE001 — fall back, never fatal
        _log.warning("ba_swot_failed", error=type(exc).__name__, detail=str(exc)[:200])
    return _swot_rule_based(cleaned)


# ─── Porter 5 Forces ───

def _porter_rule_based() -> dict[str, Any]:
    return {
        "forces": [
            {"key": k, "level": "medium", "rationale": "Oflayn rejim — kontekst təhlili üçün AI açarı tələb olunur."}
            for k in PORTER_KEYS
        ],
        "advice": "Beş qüvvənin hamısı ilkin olaraq orta qiymətləndirilib; AI açarı ilə dəqiqləşdirin.",
    }


async def porter(context: str) -> dict[str, Any]:
    cleaned = _clean(context)
    try:
        raw = await chat_json(
            PORTER_PROMPT, PORTER_USER_PROMPT.format(context=cleaned), localize=True
        )
        by_key = {
            f.get("key"): f for f in raw.get("forces", []) if isinstance(f, dict)
        }
        if by_key.keys() & set(PORTER_KEYS):
            forces = []
            for k in PORTER_KEYS:  # fixed order + fixed key set, AI can't add/drop forces
                f = by_key.get(k) or {}
                level = str(f.get("level") or "").lower()
                forces.append({
                    "key": k,
                    "level": level if level in _LEVELS else "medium",
                    "rationale": str(f.get("rationale") or "")[:500],
                })
            return {"forces": forces, "advice": str(raw.get("advice") or "")[:1000]}
    except Exception as exc:  # noqa: BLE001
        _log.warning("ba_porter_failed", error=type(exc).__name__, detail=str(exc)[:200])
    return _porter_rule_based()


# ─── BCG matrix (deterministic core, AI advice only) ───

_BCG_SQL = """
SELECT category,
  SUM(CASE WHEN CAST(substr(sale_date,6,2) AS INT) <= 6 THEN revenue ELSE 0 END) AS h1,
  SUM(CASE WHEN CAST(substr(sale_date,6,2) AS INT) >  6 THEN revenue ELSE 0 END) AS h2,
  SUM(revenue) AS total
FROM sales GROUP BY category ORDER BY total DESC
""".strip()


def _quadrant(high_share: bool, high_growth: bool) -> str:
    if high_share and high_growth:
        return "star"
    if high_share:
        return "cash_cow"
    if high_growth:
        return "question"
    return "dog"


def _median(values: list[float]) -> float:
    n = len(values)
    if not n:
        return 0.0
    mid = n // 2
    return values[mid] if n % 2 else (values[mid - 1] + values[mid]) / 2


def compute_bcg() -> dict[str, Any]:
    """Rule-based BCG over ONE demo snapshot (single seed per call).

    share = category's revenue share of total; growth = H2-vs-H1 revenue change.
    Thresholds: share ≥ median share → high; growth > 0 → high. Per-category
    live factors scale a category's H1 and H2 equally, so the growth SIGN is
    factor-invariant; shares can drift slightly between calls as the demo feed
    walks the factors (quadrants near the median may differ across runs).
    """
    rows = execute_demo_snapshot([_BCG_SQL])[0] or []
    total = sum(r["total"] for r in rows) or 1.0
    items = []
    for r in rows:
        share = r["total"] / total * 100
        # h1 == 0 with h2 > 0 is a category that LAUNCHED in H2 — the fastest
        # grower there is, not a flat one. Cap it at +100% instead of ∞.
        if r["h1"]:
            growth = (r["h2"] - r["h1"]) / r["h1"] * 100
        else:
            growth = 100.0 if r["h2"] > 0 else 0.0
        items.append({"label": str(r["category"]), "share_pct": round(share, 1), "growth_pct": round(growth, 1)})
    share_thr = _median(sorted(i["share_pct"] for i in items))
    for i in items:
        i["quadrant"] = _quadrant(i["share_pct"] >= share_thr, i["growth_pct"] > 0)
    return {
        "items": items,
        "thresholds": {"share_pct": round(share_thr, 1), "growth_pct": 0.0},
    }


def _bcg_advice_rule_based(items: list[dict[str, Any]]) -> str:
    def names(q: str) -> str:
        return ", ".join(i["label"] for i in items if i["quadrant"] == q)

    parts = []
    if names("star"):
        parts.append(f"Ulduzlara ({names('star')}) investisiyanı artırın.")
    if names("cash_cow"):
        parts.append(f"Sağmal inəklərdən ({names('cash_cow')}) gələn axını qoruyun.")
    if names("question"):
        parts.append(f"Sual işarələrini ({names('question')}) seçici test edin.")
    if names("dog"):
        parts.append(f"İtlər ({names('dog')}) üzrə xərcləri azaldın və ya çıxışı dəyərləndirin.")
    return " ".join(parts) or "Portfel datası tapılmadı."


async def bcg(context: str) -> dict[str, Any]:
    core = await asyncio.to_thread(compute_bcg)  # sqlite seed off the event loop
    try:
        raw = await chat_json(
            BCG_ADVICE_PROMPT,
            BCG_ADVICE_USER_PROMPT.format(
                items=json.dumps(core["items"], ensure_ascii=False), context=_clean(context)
            ),
            localize=True,
        )
        advice = str(raw.get("advice") or "").strip()
        if advice:
            return {**core, "advice": advice[:1500]}
    except Exception as exc:  # noqa: BLE001
        _log.warning("ba_bcg_advice_failed", error=type(exc).__name__, detail=str(exc)[:200])
    return {**core, "advice": _bcg_advice_rule_based(core["items"])}


# ─── BPMN (Mermaid) ───

_MERMAID_MAX = 4000
# Statement-position keywords that give mermaid interactivity/styling. Checked
# per line (not substring) so labels may legitimately contain the words
# "class" / "style" without tripping the sanitizer.
_MERMAID_STMT_FORBIDDEN = re.compile(
    r"^\s*(click|classDef|class|style|linkStyle)\b", re.IGNORECASE
)
# Anywhere-forbidden: directives, JS URLs, class shorthand (A:::x), and ANY "<"
# — all HTML/SVG injection needs an opening angle bracket, and the flowchart
# subset we prompt for ("-->" arrows) never does.
_MERMAID_ANY_FORBIDDEN = re.compile(r"%%\{|javascript:|:::|<", re.IGNORECASE)
_FENCE = re.compile(r"^```(?:mermaid)?\s*|\s*```$", re.MULTILINE)


def sanitize_mermaid(code: str) -> str | None:
    """Return safe flowchart code or None. Fail-closed: reject on any doubt."""
    if not code:
        return None
    cleaned = _FENCE.sub("", code.strip()).strip()
    if len(cleaned) > _MERMAID_MAX:
        return None
    if not re.match(r"^flowchart\s+(TD|TB|LR)\b", cleaned):
        return None
    if _MERMAID_ANY_FORBIDDEN.search(cleaned):
        return None
    if any(_MERMAID_STMT_FORBIDDEN.match(line) for line in cleaned.splitlines()[1:]):
        return None
    return cleaned


def _bpmn_rule_based(context: str) -> dict[str, Any]:
    """Linear flowchart from the context's step-like lines (always sanitizer-safe)."""
    steps = []
    for line in split_lines(context)[:12]:
        label = re.sub(r"[^\w\s\-,.əƏıİöÖüÜçÇşŞğĞ?%]", "", line)[:40].strip()
        if label:
            steps.append(label)
    if not steps:
        steps = ["Proses təsviri boşdur"]
    nodes = [f"  N{i}[{s}]" for i, s in enumerate(steps)]
    edges = [f"  N{i} --> N{i + 1}" for i in range(len(steps) - 1)]
    code = "flowchart TD\n" + "\n".join(nodes + edges)
    return {
        "mermaid": code,
        "summary": "Oflayn rejim: təsvirdəki addımlar ardıcıl axın kimi düzülüb.",
    }


async def bpmn(context: str) -> dict[str, Any]:
    cleaned = _clean(context)
    try:
        raw = await chat_json(
            BPMN_PROMPT, BPMN_USER_PROMPT.format(context=cleaned), localize=True
        )
        safe = sanitize_mermaid(str(raw.get("mermaid") or ""))
        if safe:
            return {"mermaid": safe, "summary": str(raw.get("summary") or "")[:500]}
        _log.warning("ba_bpmn_rejected_by_sanitizer")
    except Exception as exc:  # noqa: BLE001
        _log.warning("ba_bpmn_failed", error=type(exc).__name__, detail=str(exc)[:200])
    # The fallback goes through the SAME sanitizer — no mermaid leaves this
    # module unchecked, whatever its origin. (Its label whitelist strips every
    # forbidden char, so this only trips if the two ever drift apart.)
    out = _bpmn_rule_based(cleaned)
    if sanitize_mermaid(out["mermaid"]) is None:  # pragma: no cover — drift guard
        _log.error("ba_bpmn_fallback_failed_sanitizer")
        out["mermaid"] = "flowchart TD\n  N0[Proses]"
    return out


GENERATORS = {"swot": swot, "porter": porter, "bcg": bcg, "bpmn": bpmn}
