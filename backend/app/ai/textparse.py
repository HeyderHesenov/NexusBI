"""Shared plain-text parsing for offline (rule-based) AI fallbacks.

One source of truth for how free-form business text is split into candidate
lines — requirements extraction and the BA Studio fallbacks must segment the
same document identically.
"""
from __future__ import annotations

import re

_SENTENCE_SPLIT = re.compile(r"[\n\r]+|(?<=[.!?])\s+")
# Strip only a leading bullet / list-numbering prefix (not digits that are part
# of the content itself, e.g. "Top 5 products" / "2024 revenue").
_BULLET_PREFIX = re.compile(r"^\s*(?:[-•*]+|\d+[.)])\s*")


def clean(text: str, cap: int) -> str:
    """Trim and cap free-form input before it reaches a prompt."""
    return (text or "").strip()[:cap]


def split_lines(text: str, min_len: int = 6, max_len: int = 200) -> list[str]:
    """Split text into bullet-stripped sentence/line candidates."""
    out: list[str] = []
    for raw in _SENTENCE_SPLIT.split(text):
        line = _BULLET_PREFIX.sub("", raw).strip()
        if len(line) >= min_len:
            out.append(line[:max_len])
    return out
