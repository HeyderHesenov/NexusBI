"""Custom application exceptions."""
from __future__ import annotations


class NexusBIException(Exception):
    """Base class for all NexusBI domain errors."""

    status_code: int = 400

    def __init__(
        self, message: str, detail: str | None = None, sql: str | None = None
    ) -> None:
        super().__init__(message)
        self.message = message
        self.detail = detail
        self.sql = sql  # generated SQL, surfaced to the client on query failures


class InvalidSQLError(NexusBIException):
    status_code = 400


class DataSourceConnectionError(NexusBIException):
    status_code = 502


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
