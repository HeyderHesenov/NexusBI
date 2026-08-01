"""Loader and schema validation for the NL->SQL golden set.

The set is a JSONL file — one triple per line — rather than YAML or a database
table. JSONL because it needs no dependency beyond the stdlib, appends without
touching neighbouring lines, and diffs one case at a time; a file because a
golden set belongs where review can see what changed (an earlier migration,
``a8b9c0d1e2f3``, deleted eval tables from the database, and this deliberately
does not resurrect them).

A malformed line raises instead of being skipped. Silently dropping one would
shrink the denominator, and a metric whose denominator can quietly shrink is a
metric that can be improved by breaking a line.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

GOLDEN_PATH = Path(__file__).with_name("nl2sql.jsonl")

TIERS = ("core", "full")
LANGS = ("az", "en")

_REQUIRED = ("id", "lang", "tier", "question", "reference_sql", "ordered", "expect")
_EXPECT_KEYS = frozenset({"columns", "rows", "rows_min", "scalar"})


@dataclass(frozen=True)
class GoldenCase:
    """One (question, reference answer, shape assertion) triple.

    ``expect`` is deliberately redundant with ``reference_sql``: the reference is
    the ground truth, and ``expect`` states the same answer a second way (how
    wide, how tall, and for stable single-cell answers the value itself). A typo
    in the reference that still executes is caught by the two disagreeing.
    """

    id: str
    lang: str
    tier: str
    question: str
    reference_sql: str
    ordered: bool
    expect: dict[str, Any]
    tags: tuple[str, ...] = field(default=())

    @property
    def pair_id(self) -> str:
        """Identifier shared by this case and its other-language twin.

        Cases are authored as az/en mirrors of the same question over the same
        reference SQL, which is what makes a language-parity number free.
        """
        prefix = f"{self.lang}-"
        return self.id[len(prefix):] if self.id.startswith(prefix) else self.id


def _fail(line_no: int, message: str) -> None:
    raise ValueError(f"{GOLDEN_PATH.name}:{line_no}: {message}")


def _validate(raw: Any, line_no: int) -> GoldenCase:
    if not isinstance(raw, dict):
        _fail(line_no, "each line must be a JSON object")
    missing = [key for key in _REQUIRED if key not in raw]
    if missing:
        _fail(line_no, f"missing required key(s): {', '.join(missing)}")
    unknown = set(raw) - set(_REQUIRED) - {"tags"}
    if unknown:
        _fail(line_no, f"unknown key(s): {', '.join(sorted(unknown))}")

    if raw["lang"] not in LANGS:
        _fail(line_no, f"lang must be one of {LANGS}, got {raw['lang']!r}")
    if raw["tier"] not in TIERS:
        _fail(line_no, f"tier must be one of {TIERS}, got {raw['tier']!r}")
    if not isinstance(raw["ordered"], bool):
        _fail(line_no, "ordered must be a boolean")
    for key in ("id", "question", "reference_sql"):
        if not isinstance(raw[key], str) or not raw[key].strip():
            _fail(line_no, f"{key} must be a non-empty string")
    if not raw["id"].startswith(f"{raw['lang']}-"):
        _fail(line_no, f"id {raw['id']!r} must start with its lang prefix {raw['lang']}-")

    expect = raw["expect"]
    if not isinstance(expect, dict):
        _fail(line_no, "expect must be an object")
    unknown_expect = set(expect) - _EXPECT_KEYS
    if unknown_expect:
        _fail(line_no, f"unknown expect key(s): {', '.join(sorted(unknown_expect))}")
    if not isinstance(expect.get("columns"), int) or expect["columns"] < 1:
        _fail(line_no, "expect.columns must be a positive integer")
    if "rows" not in expect and "rows_min" not in expect:
        _fail(line_no, "expect must state rows or rows_min")
    for key in ("rows", "rows_min"):
        if key in expect and (not isinstance(expect[key], int) or expect[key] < 0):
            _fail(line_no, f"expect.{key} must be a non-negative integer")
    if "scalar" in expect and (expect.get("columns") != 1 or expect.get("rows") != 1):
        _fail(line_no, "expect.scalar is only meaningful with columns=1 and rows=1")

    tags = raw.get("tags", [])
    if not isinstance(tags, list) or any(not isinstance(t, str) for t in tags):
        _fail(line_no, "tags must be a list of strings")

    return GoldenCase(
        id=raw["id"],
        lang=raw["lang"],
        tier=raw["tier"],
        question=raw["question"],
        reference_sql=" ".join(raw["reference_sql"].split()),
        ordered=raw["ordered"],
        expect=expect,
        tags=tuple(tags),
    )


def load_golden(path: Path | None = None) -> list[GoldenCase]:
    """Parse and validate the golden set. Raises on any malformed entry."""
    source = path or GOLDEN_PATH
    cases: list[GoldenCase] = []
    seen: dict[str, int] = {}
    for line_no, line in enumerate(source.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip() or line.lstrip().startswith("//"):
            continue
        try:
            raw = json.loads(line)
        except json.JSONDecodeError as exc:
            raise ValueError(f"{source.name}:{line_no}: invalid JSON — {exc}") from exc
        case = _validate(raw, line_no)
        if case.id in seen:
            _fail(line_no, f"duplicate id {case.id!r} (first seen on line {seen[case.id]})")
        seen[case.id] = line_no
        cases.append(case)
    if not cases:
        raise ValueError(f"{source.name}: golden set is empty")
    return cases
