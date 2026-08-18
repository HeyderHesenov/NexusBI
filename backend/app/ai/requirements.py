"""Extract measurable KPIs from a requirements document (BRD / user story).

AI-first with a deterministic rule-based fallback so the requirements→dashboard
flow still works fully offline.
"""
from __future__ import annotations

import math
import re
from typing import Any

from app.ai.client import chat_json
from app.ai.prompt_templates import REQUIREMENTS_PROMPT, REQUIREMENTS_USER_PROMPT
from app.core.logging import get_logger

_log = get_logger("nexusbi.ai")
_MAX_CHARS = 12000  # cap prompt size
_MAX_KPIS = 8

# Lines hinting at something measurable (AZ + EN), used by the offline fallback.
_METRIC_HINTS = re.compile(
    r"(gəlir|satış|sayı|say\b|faiz|nisbət|trend|orta|cəm|ən çox|ən az|top|"
    r"revenue|sales|count|number|rate|ratio|percent|%|total|average|avg|"
    r"churn|conversion|growth|kpi|metr)",
    re.IGNORECASE,
)


# ─── Acceptance criterion coercion ───
#
# A KPI's target is what makes it testable, so it lands on Decision.predicted_value
# and decides `achieved`. Both coercers therefore refuse rather than guess: a None
# target simply means the form asks the human for the number, whereas a fabricated
# one becomes an acceptance criterion nobody wrote.

# Beyond this a Float column is not meaningfully precise and the "target" is noise.
_MAX_TARGET_MAGNITUDE = 1e15

_NOT_A_NUMBER = frozenset(
    {"", "null", "none", "nan", "n/a", "na", "-", "—", "yes", "no", "true", "false"}
)
# Comparison/approximation marks and currency signs carry no magnitude.
_TARGET_NOISE = re.compile(r"[>≥<≤~≈+$€₼£₽₺]")
# Unit words that do NOT rescale the number — see the percent note in _coerce_target.
_TARGET_UNITS = re.compile(r"\b(percent|faiz|yüzde|процент[а-я]*)\b|%", re.IGNORECASE)
# A space only groups digits when exactly three follow it ("12 000"), so this
# runs BEFORE tokenising and nothing else may contain whitespace.
_SPACE_GROUP = re.compile(r"(?<=\d)[ \u00a0](?=\d{3}\b)")
# One number: digits joined by , . or _ and NOTHING else. Whitespace is excluded
# deliberately — allowing it let "5, 6, 7" parse as the single number 567, which
# is the invented-threshold failure this module exists to prevent.
_NUMBER_TOKEN = re.compile(r"[-+]?\d[\d.,_]*\d|[-+]?\d")

# Azerbaijani casing does not round-trip through Python's default .lower()
# ("ARTIM" -> "artim", never "artım"), so both the keys below and the lookup are
# folded. This keeps the match EXACT — it widens spelling, not matching.
_FOLD = str.maketrans(
    {"\u0131": "i", "\u0130": "i", "\u0259": "e", "\u015f": "s",
     "\u00e7": "c", "\u011f": "g", "\u00f6": "o", "\u00fc": "u"}
)


def _fold(text: str) -> str:
    return text.strip().lower().translate(_FOLD)


_DIRECTION_WORDS: dict[str, str] = {
    "increase": "increase", "increasing": "increase", "up": "increase",
    "grow": "increase", "growth": "increase", "higher": "increase",
    "more": "increase", "rise": "increase", "↑": "increase",
    "artım": "increase", "artmalı": "increase", "artır": "increase",
    "yüksəlmə": "increase",
    "decrease": "decrease", "decreasing": "decrease", "down": "decrease",
    "reduce": "decrease", "reduction": "decrease", "lower": "decrease",
    "less": "decrease", "drop": "decrease", "fall": "decrease",
    "azalma": "decrease", "azalmalı": "decrease", "azal": "decrease",
    "aşağı": "decrease", "enmə": "decrease", "↓": "decrease",
}
_DIRECTIONS: dict[str, str] = {_fold(k): v for k, v in _DIRECTION_WORDS.items()}
# Two spellings folding onto one key is fine while they agree; folding onto one
# key with OPPOSITE directions is the inversion this whole function exists to
# prevent, and dict-building would resolve it silently by insertion order.
_collisions = {
    _fold(k) for k in _DIRECTION_WORDS if _DIRECTIONS[_fold(k)] != _DIRECTION_WORDS[k]
}
assert not _collisions, f"folded direction keys disagree: {sorted(_collisions)}"


def _finite(x: float) -> float | None:
    if not math.isfinite(x) or abs(x) > _MAX_TARGET_MAGNITUDE:
        return None
    # Normalises -0.0 to 0.0. Note for every reader of this value: test it with
    # `is not None`, NEVER truthiness. 0.0 is a legitimate target ("səhv sayı 0
    # olmalıdır") and it is falsy, so `if target:` would drop a real criterion.
    return 0.0 if x == 0 else x


def _normalize_separators(token: str) -> str:
    """Resolve `.` / `,` as decimal mark vs thousands group (AZ writes 15,5)."""
    t = re.sub(r"_", "", token)
    has_dot, has_comma = "." in t, "," in t
    if has_dot and has_comma:
        # The rightmost of the two is the decimal mark; the other groups digits.
        dec = "." if t.rfind(".") > t.rfind(",") else ","
        grp = "," if dec == "." else "."
        return t.replace(grp, "").replace(dec, ".")
    sep = "." if has_dot else ("," if has_comma else "")
    if not sep:
        return t
    if t.count(sep) > 1:
        return t.replace(sep, "")  # only grouping can repeat: 1.234.567
    head, _, tail = t.partition(sep)
    if len(tail) == 3 and head.lstrip("+-").isdigit():
        # Exactly three trailing digits is a thousands group far more often than a
        # three-decimal KPI threshold, so "1,500" and "1.500" both mean 1500.
        return head + tail
    return t.replace(sep, ".")


def _coerce_target(value: Any) -> float | None:
    """Return the single number a model proposed as the target, else None."""
    if isinstance(value, (dict, list, tuple, set)):
        return None
    # Ahead of the int/float branch on purpose: float(True) is 1.0, so a JSON
    # `true` would otherwise arrive as an entirely plausible target of 1.
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return _finite(float(value))
    if not isinstance(value, str):
        return None

    s = value.strip()
    if s.lower() in _NOT_A_NUMBER:
        return None
    # Percent is NOT rescaled: predicted_value is compared against extract_scalar()
    # of the metric query, and "konversiya faizi" returns 15 from SQL, not 0.15.
    # Dividing here would mint a criterion that can never be met.
    s = _SPACE_GROUP.sub("", _TARGET_UNITS.sub("", _TARGET_NOISE.sub("", s)))

    tokens = _NUMBER_TOKEN.findall(s)
    # Exactly one. "12%-15%", "10 to 20" and "between 5 and 9" all yield two, and
    # silently taking an end of a range is how you invent an acceptance criterion.
    if len(tokens) != 1:
        return None
    try:
        return _finite(float(_normalize_separators(tokens[0])))
    except ValueError:
        return None


def _coerce_direction(value: Any) -> str | None:
    """Map a proposed direction onto the two values the Decision loop understands.

    EXACT dictionary lookup, never a substring scan. "increase then decrease" and
    "not decrease" both contain a keyword, and whichever a substring scan tested
    first would silently INVERT the criterion — the KPI would then report
    "achieved" for precisely the outcome the requirement forbids. `+`/`-` are
    deliberately absent: a bare "-" is far more often "not applicable" than
    "decrease", and reading it as a direction is that same inversion.
    """
    if isinstance(value, bool) or not isinstance(value, str):
        return None
    return _DIRECTIONS.get(_fold(value))


def _clean(text: str) -> str:
    return (text or "").strip()[:_MAX_CHARS]


def _rule_based(text: str) -> dict[str, Any]:
    """Pick measurable-looking lines and turn each into a KPI question."""
    kpis: list[dict[str, str]] = []
    seen: set[str] = set()
    for raw in re.split(r"[\n\r]+|(?<=[.!?])\s+", text):
        # Strip only a leading bullet / list-numbering prefix (not digits that are
        # part of the metric itself, e.g. "Top 5 products" / "2024 revenue").
        line = re.sub(r"^\s*(?:[-•*]+|\d+[.)])\s*", "", raw).strip()
        if len(line) < 6 or not _METRIC_HINTS.search(line):
            continue
        key = line.lower()
        if key in seen:
            continue
        seen.add(key)
        short = line[:60]
        kpis.append(
            {
                "name": short,
                "question": line if line.endswith("?") else f"{line} — göstər",
                "rationale": "Tələb sənədindən çıxarıldı.",
                "requirement_ref": short,
            }
        )
        if len(kpis) >= _MAX_KPIS:
            break
    return {"kpis": kpis}


async def extract_kpis(text: str) -> dict[str, Any]:
    """Return {"kpis": [{name, question, rationale, requirement_ref}, ...]}."""
    cleaned = _clean(text)
    if not cleaned:
        return {"kpis": []}
    try:
        raw = await chat_json(
            REQUIREMENTS_PROMPT,
            REQUIREMENTS_USER_PROMPT.format(text=cleaned),
            feature="requirements",
        )
        kpis = raw.get("kpis")
        if isinstance(kpis, list) and kpis:
            # Keep only well-formed entries; cap the count.
            out = [
                {
                    "name": str(k.get("name") or k.get("question") or "KPI")[:120],
                    "question": str(k.get("question") or k.get("name") or "").strip(),
                    "rationale": str(k.get("rationale") or "")[:500],
                    "requirement_ref": str(k.get("requirement_ref") or "")[:500],
                    # Proposals only — the human confirms them before they become
                    # a Decision's predicted_value/direction. A bad one degrades
                    # to None; it never rejects the KPI, because losing a KPI over
                    # a sloppy number is worse than losing the pre-fill.
                    "target_value": _coerce_target(k.get("target_value")),
                    "direction": _coerce_direction(k.get("direction")),
                }
                for k in kpis
                if isinstance(k, dict) and (k.get("question") or k.get("name"))
            ]
            out = [k for k in out if k["question"]][:_MAX_KPIS]
            if out:
                return {"kpis": out}
    except Exception as exc:  # noqa: BLE001 — fall back, never fatal
        _log.warning("requirements_ai_failed", error=type(exc).__name__, detail=str(exc)[:200])
    return _rule_based(cleaned)
