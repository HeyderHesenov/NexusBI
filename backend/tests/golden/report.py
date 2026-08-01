"""Scoring and reporting for the NL->SQL eval harness.

Separate from the test module so ``tests/conftest.py`` can print the summary in
pytest's terminal-summary section: a passing test's stdout is swallowed by
capture, and a number nobody sees is not a published number.
"""
from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

# backend/eval-report.json by default (this file lives at backend/tests/golden/).
DEFAULT_REPORT_PATH = Path(__file__).resolve().parents[2] / "eval-report.json"

# Set when a report is written during THIS session. Without it a stale file from
# an earlier run would be printed after a suite that never ran the eval.
_written: dict[str, Any] | None = None


@dataclass
class CaseOutcome:
    id: str
    lang: str
    tier: str
    question: str
    correct: bool
    generated_sql: str = ""
    error: str = ""


@dataclass
class EvalRun:
    """One pass of the golden set through one engine."""

    engine: str
    outcomes: list[CaseOutcome] = field(default_factory=list)

    def rate(self, **filters: str) -> tuple[int, int]:
        """(correct, total) over the outcomes matching every given attribute."""
        subset = [
            o for o in self.outcomes
            if all(getattr(o, key) == value for key, value in filters.items())
        ]
        return sum(1 for o in subset if o.correct), len(subset)


def _ratio(correct: int, total: int) -> float | None:
    return round(correct / total, 4) if total else None


def summarize(run: EvalRun) -> dict[str, Any]:
    """The published shape: one headline number plus the breakdowns that explain it."""
    payload: dict[str, Any] = {"engine": run.engine, "metric": "nl2sql_exact@1"}
    overall = run.rate()
    payload["overall"] = {"correct": overall[0], "total": overall[1], "score": _ratio(*overall)}
    payload["by_tier"] = {
        tier: {"correct": c, "total": t, "score": _ratio(c, t)}
        for tier in ("core", "full")
        for c, t in [run.rate(tier=tier)]
    }
    payload["by_lang"] = {
        lang: {"correct": c, "total": t, "score": _ratio(c, t)}
        for lang in ("az", "en")
        for c, t in [run.rate(lang=lang)]
    }
    payload["failures"] = [
        {"id": o.id, "tier": o.tier, "question": o.question, "sql": o.generated_sql, "error": o.error}
        for o in run.outcomes
        if not o.correct
    ]
    return payload


def report_path() -> Path:
    override = os.getenv("NEXUSBI_EVAL_REPORT")
    return Path(override) if override else DEFAULT_REPORT_PATH


def write(run: EvalRun) -> dict[str, Any]:
    global _written
    payload = summarize(run)
    payload["outcomes"] = [asdict(o) for o in run.outcomes]
    path = report_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    _written = payload
    return payload


def _pct(entry: dict[str, Any]) -> str:
    if entry["score"] is None:
        return "n/a"
    return f"{entry['score']:.2f}  ({entry['correct']}/{entry['total']})"


def terminal_lines() -> list[str]:
    """Summary lines for pytest's terminal report — empty unless this session ran."""
    if _written is None:
        return []
    payload = _written
    lines = [f"NL2SQL eval — engine={payload['engine']}"]
    for tier in ("core", "full"):
        lines.append(f"  nl2sql_exact@1 ({tier}): {_pct(payload['by_tier'][tier])}")
    lines.append(f"  nl2sql_exact@1 (all):  {_pct(payload['overall'])}")
    parity = " · ".join(f"{lang} {_pct(payload['by_lang'][lang])}" for lang in ("az", "en"))
    lines.append(f"  language parity: {parity}")
    lines.append(f"  report: {report_path()}")
    return lines
