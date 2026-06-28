"""NL data-prep: turn a natural-language transform into a single SELECT.

AI-first; a minimal rule-based fallback keeps the simplest cases working offline.
The SQL is always re-validated with ``validate_select_only`` before execution.
"""
from __future__ import annotations

import re
from typing import Any

from app.ai.client import chat_json
from app.ai.prompt_templates import DATA_PREP_PROMPT, DATA_PREP_USER_PROMPT
from app.core.logging import get_logger

_log = get_logger("nexusbi.ai")


def _tables_from_schema(schema_text: str) -> list[str]:
    # schema lines look like "- table(col (type), ...)"
    return re.findall(r"^-\s*([A-Za-z_][\w]*)\s*\(", schema_text, re.MULTILINE)


def _rule_based(schema_text: str, instruction: str) -> dict[str, Any]:
    """Best-effort offline fallback: if the instruction names a known table,
    return a bounded passthrough SELECT; otherwise warn that AI is needed."""
    tables = _tables_from_schema(schema_text)
    lower = instruction.lower()
    # Only act on a table the instruction actually names — never silently default
    # to an arbitrary table the user didn't ask for.
    match = next((t for t in tables if t.lower() in lower), None)
    if not match:
        return {
            "sql": "",
            "steps": [],
            "warnings": ["AI əlçatan deyil və tapşırıqda tanınan cədvəl adı yoxdur."],
        }
    return {
        "sql": f'SELECT * FROM "{match}" LIMIT 1000',
        "steps": [f"{match} cədvəlindən nümunə sətirlər götürüldü (offline rejim)."],
        "warnings": ["AI əlçatan olmadığı üçün sadə passthrough istifadə olundu."],
    }


async def plan_transform(schema_text: str, instruction: str) -> dict[str, Any]:
    """Return {"sql": str, "steps": [str], "warnings": [str]}."""
    try:
        raw = await chat_json(
            DATA_PREP_PROMPT,
            DATA_PREP_USER_PROMPT.format(schema=schema_text, instruction=instruction),
        )
        sql = str(raw.get("sql") or "").strip()
        if sql:
            steps = [str(s) for s in raw.get("steps", []) if isinstance(s, str)]
            warnings = [str(w) for w in raw.get("warnings", []) if isinstance(w, str)]
            return {"sql": sql, "steps": steps, "warnings": warnings}
    except Exception as exc:  # noqa: BLE001 — fall back, never fatal
        _log.warning("data_prep_ai_failed", error=type(exc).__name__, detail=str(exc)[:200])
    return _rule_based(schema_text, instruction)
