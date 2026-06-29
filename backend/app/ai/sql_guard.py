"""SELECT-only SQL validation.

Defends the AI→SQL execution path. A statement is allowed only if, after
stripping comments and string-literal *contents* (so keywords inside literals
don't false-positive), it is a single statement that starts with SELECT/WITH,
contains no SELECT…INTO write clause, and calls no dangerous function
(RCE / file read / DoS / exfil).
"""
from __future__ import annotations

import re

import sqlglot
from sqlglot import exp

from app.core.exceptions import InvalidSQLError

# sqlglot dialect names keyed by our DBType.value.
_GLOT_DIALECTS = {"postgresql": "postgres", "mysql": "mysql", "sqlite": "sqlite"}

# DB metadata/catalog tables — reading them exfiltrates schema/credentials/stats.
# Blocked regardless of the introspected schema (defense in depth at execution).
_FORBIDDEN_TABLES = re.compile(
    r"\b(sqlite_master|sqlite_temp_master|sqlite_schema|sqlite_sequence|"
    r"information_schema|pg_catalog|pg_class|pg_attribute|pg_shadow|pg_user|"
    r"pg_authid|pg_roles|pg_stat_\w+|mysql\.user|performance_schema)\b",
    re.IGNORECASE,
)

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
    if _FORBIDDEN_TABLES.search(scrubbed):
        raise InvalidSQLError("Disallowed system/catalog table reference.")

    return cleaned


def assert_tables_in_schema(
    sql: str, allowed_tables: list[str], dialect: str = "sqlite"
) -> None:
    """Reject a SELECT that reads any base table outside the introspected schema.

    Positive allowlisting (on top of the metadata denylist above): the only
    physical tables a generated query may touch are those the user's datasource
    actually exposes. CTE/derived-relation names are excluded — they're not base
    tables. Fail-CLOSED on parse failure.
    """
    allowed = {t.lower() for t in allowed_tables}
    try:
        tree = sqlglot.parse_one(sql, dialect=_GLOT_DIALECTS.get(dialect, "sqlite"))
    except Exception as exc:  # noqa: BLE001 — any parse failure → block
        raise InvalidSQLError("SQL təhlil olunmadı (allowlist).") from exc
    if tree is None:
        raise InvalidSQLError("Boş SQL.")
    cte_names = {c.alias.lower() for c in tree.find_all(exp.CTE) if c.alias}
    for table in tree.find_all(exp.Table):
        name = (table.name or "").lower()
        if not name or name in cte_names:
            continue
        if name not in allowed:
            raise InvalidSQLError(f"İcazəsiz cədvələ müraciət: {table.name}")
