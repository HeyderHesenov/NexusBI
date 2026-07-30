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

from app.ai import ba_bcg, ba_evidence
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

_log = get_logger("nexusbi.ai")

_MAX_CONTEXT = 8000
_MAX_ITEMS = 6  # per SWOT bucket
_MAX_ACTIONS = 5
_LEVELS = {"low", "medium", "high"}
_DIRECTIONS = {"increase", "decrease"}
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


def _items(v: Any, cap: int = _MAX_ITEMS) -> list[dict[str, Any]]:
    """Normalise a bucket into ``{text, evidence, derived}`` items.

    Model-authored bullets never carry evidence (``derive_items`` is the only
    source of fact ids — see the ba_evidence module docstring), so they are marked
    ``derived: False`` and the UI labels them a judgement. Accepts both a bare
    string and an object, so a model that volunteers ``{"text": ...}`` still parses.
    """
    if not isinstance(v, list):
        return []
    out: list[dict[str, Any]] = []
    for x in v:
        text = str(x.get("text") if isinstance(x, dict) else x).strip()
        if text:
            out.append({"text": text[:300], "evidence": [], "derived": False})
    return out[:cap]


def _int_1_5(v: Any) -> int:
    """Clamp an AI-supplied score into 1..5; anything non-numeric reads as middling."""
    try:
        return max(1, min(5, int(float(v))))
    except (TypeError, ValueError):
        return 3


def _actions(v: Any, cap: int = _MAX_ACTIONS) -> list[dict[str, Any]]:
    """Normalise the prioritised action list, pinning every field to a safe range."""
    if not isinstance(v, list):
        return []
    out: list[dict[str, Any]] = []
    for x in v:
        if not isinstance(x, dict):
            continue
        text = str(x.get("text") or "").strip()
        if not text:
            continue
        direction = str(x.get("direction") or "").lower()
        out.append({
            "text": text[:300],
            "impact": _int_1_5(x.get("impact")),
            "effort": _int_1_5(x.get("effort")),
            "metric_hint": str(x.get("metric_hint") or "").strip()[:300],
            "direction": direction if direction in _DIRECTIONS else "increase",
            "derived": False,
        })
    return out[:cap]


def _merge_actions(
    ai: list[dict[str, Any]],
    derived: list[dict[str, Any]],
    structural: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Fact-derived first (provably data-backed), then AI, then the structural backstop.

    Structural actions come last so a good AI response is never diluted by generic
    ones — they only surface when there is room, which is exactly the keyless case.
    """
    return (derived + ai + (structural or []))[:_MAX_ACTIONS]


# ─── SWOT ───

_SWOT_BUCKETS = ("strengths", "weaknesses", "opportunities", "threats")


def _swot_rule_based(context: str) -> dict[str, Any]:
    buckets: dict[str, list[dict[str, Any]]] = {k: [] for k in _SWOT_BUCKETS}
    for line in split_lines(context):
        for key, hint in _SWOT_HINTS:
            if hint.search(line):
                if len(buckets[key]) < _MAX_ITEMS:
                    buckets[key].append({"text": line[:300], "evidence": [], "derived": False})
                break
    return {
        **buckets,
        "advice": (
            "Oflayn qayda-əsaslı təhlil: bəndlər kontekst mətnindəki açar sözlərə görə "
            "qruplaşdırılıb. Dərin SWOT üçün AI açarı tələb olunur."
        ),
    }


def _merge_derived(
    buckets: dict[str, list[dict[str, Any]]], facts: list[dict[str, Any]]
) -> dict[str, list[dict[str, Any]]]:
    """Prepend the rule-derived, fact-backed bullets to each bucket."""
    derived = ba_evidence.derive_items(facts)
    return {k: (derived.get(k, []) + buckets.get(k, []))[:_MAX_ITEMS] for k in _SWOT_BUCKETS}


async def swot(
    context: str, facts: list[dict[str, Any]], core: dict[str, Any] | None = None
) -> dict[str, Any]:
    cleaned = _clean(context)
    facts_json = json.dumps(facts, ensure_ascii=False)
    out: dict[str, Any] | None = None
    try:
        raw = await chat_json(
            SWOT_PROMPT,
            SWOT_USER_PROMPT.format(context=cleaned, facts=facts_json),
            localize=True,
            feature="ba_frameworks",
        )
        parsed: dict[str, Any] = {k: _items(raw.get(k)) for k in _SWOT_BUCKETS}
        if any(parsed.values()):
            parsed["advice"] = str(raw.get("advice") or "")[:1000]
            parsed["actions"] = _actions(raw.get("actions"))
            out = parsed
    except Exception as exc:  # noqa: BLE001 — fall back, never fatal
        _log.warning("ba_swot_failed", error=type(exc).__name__, detail=str(exc)[:200])
    if out is None:
        out = _swot_rule_based(cleaned)
        out["actions"] = []
    out.update(_merge_derived(out, facts))
    out["actions"] = _merge_actions(
        out["actions"],
        ba_evidence.derive_actions(facts, "swot"),
        ba_evidence.derive_structural_actions("swot", out, facts),
    )
    return out


# ─── Porter 5 Forces ───

def _porter_rule_based() -> dict[str, Any]:
    return {
        "forces": [
            {"key": k, "level": "medium", "rationale": "Oflayn rejim — kontekst təhlili üçün AI açarı tələb olunur."}
            for k in PORTER_KEYS
        ],
        "advice": "Beş qüvvənin hamısı ilkin olaraq orta qiymətləndirilib; AI açarı ilə dəqiqləşdirin.",
    }


async def porter(
    context: str, facts: list[dict[str, Any]], core: dict[str, Any] | None = None
) -> dict[str, Any]:
    cleaned = _clean(context)
    facts_json = json.dumps(facts, ensure_ascii=False)
    out: dict[str, Any] | None = None
    try:
        raw = await chat_json(
            PORTER_PROMPT,
            PORTER_USER_PROMPT.format(context=cleaned, facts=facts_json),
            localize=True,
            feature="ba_frameworks",
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
            out = {
                "forces": forces,
                "advice": str(raw.get("advice") or "")[:1000],
                "actions": _actions(raw.get("actions")),
            }
    except Exception as exc:  # noqa: BLE001
        _log.warning("ba_porter_failed", error=type(exc).__name__, detail=str(exc)[:200])
    if out is None:
        out = _porter_rule_based()
        out["actions"] = []
    # Porter levels are NOT forced from the fact pack: there is no honest mapping
    # from a sales table to "supplier power", and inventing one would be exactly
    # the unverifiable grounding this feature exists to avoid. The facts inform the
    # model's judgement and show as artifact-level chips instead.
    out["actions"] = _merge_actions(
        out["actions"],
        ba_evidence.derive_actions(facts, "porter"),
        ba_evidence.derive_structural_actions("porter", out, facts),
    )
    return out


# ─── BCG matrix (deterministic core in ba_bcg, AI advice only) ───

# Keys ba_bcg puts on the core for the service/evidence layer, not for the artifact.
_CORE_INTERNAL = frozenset({"source_name", "metric"})


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


async def bcg(
    context: str, facts: list[dict[str, Any]], core: dict[str, Any] | None = None
) -> dict[str, Any]:
    # The matrix is computed by the caller (ba_service) because it needs the db /
    # cache to reach a live source. Demo-only callers may omit it.
    if core is None:
        core = await asyncio.to_thread(ba_bcg.compute_bcg)
    # `core` also carries provenance fields (source_name / metric) that feed evidence
    # and labelling but are NOT artifact content: ba_service is the single writer of
    # `content["source_name"]`, and it deliberately writes nothing for the demo model
    # so the UI can render its own localized label. Copying core wholesale would ship
    # ba_bcg's hardcoded "Demo" instead.
    out = {k: v for k, v in core.items() if k not in _CORE_INTERNAL}
    ai_actions: list[dict[str, Any]] = []
    advice = ""
    try:
        raw = await chat_json(
            BCG_ADVICE_PROMPT,
            BCG_ADVICE_USER_PROMPT.format(
                items=json.dumps(core["items"], ensure_ascii=False), context=_clean(context)
            ),
            localize=True,
            feature="ba_frameworks",
        )
        advice = str(raw.get("advice") or "").strip()[:1500]
        ai_actions = _actions(raw.get("actions"))
    except Exception as exc:  # noqa: BLE001
        _log.warning("ba_bcg_advice_failed", error=type(exc).__name__, detail=str(exc)[:200])
    out["advice"] = advice or _bcg_advice_rule_based(core["items"])
    out["actions"] = _merge_actions(ai_actions, ba_evidence.derive_actions(facts, "bcg", core))
    return out


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


async def bpmn(
    context: str, facts: list[dict[str, Any]], core: dict[str, Any] | None = None
) -> dict[str, Any]:
    cleaned = _clean(context)
    out: dict[str, Any] | None = None
    try:
        raw = await chat_json(
            BPMN_PROMPT,
            BPMN_USER_PROMPT.format(context=cleaned),
            localize=True,
            feature="ba_frameworks",
        )
        safe = sanitize_mermaid(str(raw.get("mermaid") or ""))
        if safe:
            out = {
                "mermaid": safe,
                "summary": str(raw.get("summary") or "")[:500],
                "actions": _actions(raw.get("actions")),
            }
        else:
            _log.warning("ba_bpmn_rejected_by_sanitizer")
    except Exception as exc:  # noqa: BLE001
        _log.warning("ba_bpmn_failed", error=type(exc).__name__, detail=str(exc)[:200])
    if out is None:
        # The fallback goes through the SAME sanitizer — no mermaid leaves this
        # module unchecked, whatever its origin. (Its label whitelist strips every
        # forbidden char, so this only trips if the two ever drift apart.)
        out = _bpmn_rule_based(cleaned)
        out["actions"] = []
        if sanitize_mermaid(out["mermaid"]) is None:  # pragma: no cover — drift guard
            _log.error("ba_bpmn_fallback_failed_sanitizer")
            out["mermaid"] = "flowchart TD\n  N0[Proses]"
    out["actions"] = _merge_actions(
        out["actions"],
        ba_evidence.derive_actions(facts, "bpmn"),
        ba_evidence.derive_structural_actions("bpmn", out, facts),
    )
    return out


GENERATORS = {"swot": swot, "porter": porter, "bcg": bcg, "bpmn": bpmn}

# Re-exported so existing importers (and tests) keep reaching the demo matrix here.
compute_bcg = ba_bcg.compute_bcg
