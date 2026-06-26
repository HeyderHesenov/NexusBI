"""SELECT-only SQL validation.

Defends the AI→SQL execution path. A statement is allowed only if, after
stripping comments and string-literal *contents* (so keywords inside literals
don't false-positive), it is a single statement that starts with SELECT/WITH,
contains no SELECT…INTO write clause, and calls no dangerous function
(RCE / file read / DoS / exfil).
"""
from __future__ import annotations

import re

from app.core.exceptions import InvalidSQLError

# SELECT … INTO is a write (e.g. MySQL INTO OUTFILE/DUMPFILE, MSSQL SELECT INTO).
_INTO_CLAUSE = re.compile(r"\binto\b", re.IGNORECASE)

# Dangerous functions reachable from a SELECT (RCE, file read, DoS, exfil).
_FORBIDDEN_FUNCTIONS = re.compile(
    r"\b(load_extension|readfile|writefile|pg_sleep|sleep|benchmark|"
    r"pg_read_file|pg_ls_dir|pg_read_binary_file|lo_import|lo_export|"
    r"dblink|dbms_|utl_|xp_cmdshell|sp_)\w*",
    re.IGNORECASE,
)

# Statement keywords that must never appear, even though a single SELECT/WITH
# start already blocks them as leading tokens (defense in depth vs. clever
# embedding / parser quirks): SQLite PRAGMA/ATTACH/DETACH/VACUUM, etc.
_FORBIDDEN_KEYWORDS = re.compile(
    r"\b(pragma|attach|detach|vacuum|reindex)\b",
    re.IGNORECASE,
)


def _strip_comments(sql: str) -> str:
    sql = re.sub(r"--[^\n]*", " ", sql)
    return re.sub(r"/\*.*?\*/", " ", sql, flags=re.DOTALL)


def _scrub(sql: str) -> str:
    """Blank out string-literal / quoted-identifier contents for keyword scanning."""
    sql = re.sub(r"'(?:''|[^'])*'", "''", sql)
    sql = re.sub(r'"(?:""|[^"])*"', '""', sql)
    return sql


def validate_select_only(sql: str) -> str:
    """Return the cleaned SQL if it is a single safe SELECT, else raise."""
    cleaned = _strip_comments(sql).strip().rstrip(";").strip()
    if not cleaned:
        raise InvalidSQLError("Empty SQL query.")

    scrubbed = _scrub(cleaned)
    if ";" in scrubbed:
        raise InvalidSQLError("Only a single statement is allowed.")

    lowered = scrubbed.lstrip().lower()
    if not (lowered.startswith("select") or lowered.startswith("with")):
        raise InvalidSQLError("Only SELECT queries are permitted.")
    if _INTO_CLAUSE.search(scrubbed):
        raise InvalidSQLError("SELECT … INTO is not permitted.")
    if _FORBIDDEN_FUNCTIONS.search(scrubbed):
        raise InvalidSQLError("Disallowed SQL function detected.")
    if _FORBIDDEN_KEYWORDS.search(scrubbed):
        raise InvalidSQLError("Disallowed SQL keyword detected.")

    return cleaned
