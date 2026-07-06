"""Custom application exceptions."""
from __future__ import annotations


class NexusBIException(Exception):
    """Base class for all NexusBI domain errors."""

    status_code: int = 400

    def __init__(
        self,
        message: str,
        detail: str | None = None,
        sql: str | None = None,
        code: str | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.detail = detail
        self.sql = sql  # generated SQL, surfaced to the client on query failures
        # Optional machine-readable marker so clients can branch on the CAUSE
        # (e.g. "ai_quota" vs a transient per-IP throttle) without parsing
        # localized message text.
        self.code = code


class InvalidSQLError(NexusBIException):
    status_code = 400


class DataSourceConnectionError(NexusBIException):
    status_code = 502


class QueryExecutionError(DataSourceConnectionError):
    """The SQL ran but the DB rejected it (bad column/join/type/syntax). Distinct
    from a connection/timeout failure so callers can REPAIR it (feed the error back
    to the model) rather than pointlessly retrying an unreachable/slow source.
    Subclasses DataSourceConnectionError so existing handlers still catch it."""


class AIGenerationError(NexusBIException):
    status_code = 502


class SchemaNotFoundError(NexusBIException):
    status_code = 404


class AuthError(NexusBIException):
    status_code = 401


class ForbiddenError(NexusBIException):
    status_code = 403


class RateLimitError(NexusBIException):
    status_code = 429
