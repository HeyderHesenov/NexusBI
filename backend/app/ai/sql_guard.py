"""SELECT-only SQL validation. Defends against write/DDL statements."""
from __future__ import annotations

import re

from app.core.exceptions import InvalidSQLError

_FORBIDDEN = re.compile(
    r"\b(insert|update|delete|drop|alter|truncate|create|replace|"
    r"grant|revoke|merge|call|exec|execute|attach|pragma|vacuum)\b",
    re.IGNORECASE,
)


def _strip_comments(sql: str) -> str:
    sql = re.sub(r"--[^\n]*", " ", sql)
    sql = re.sub(r"/\*.*?\*/", " ", sql, flags=re.DOTALL)
    return sql


def validate_select_only(sql: str) -> str:
    """Return the cleaned SQL if it is a single safe SELECT, else raise."""
    cleaned = _strip_comments(sql).strip().rstrip(";").strip()
    if not cleaned:
        raise InvalidSQLError("Empty SQL query.")

    statements = [s for s in cleaned.split(";") if s.strip()]
    if len(statements) > 1:
        raise InvalidSQLError("Only a single statement is allowed.")

    lowered = cleaned.lower()
    if not (lowered.startswith("select") or lowered.startswith("with")):
        raise InvalidSQLError("Only SELECT queries are permitted.")

    if _FORBIDDEN.search(cleaned):
        raise InvalidSQLError("Write/DDL keywords are not permitted.")

    return cleaned
