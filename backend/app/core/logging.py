"""Structured logging setup using structlog."""
from __future__ import annotations

import logging
import sys

import structlog


def configure_logging() -> None:
    """Configure structlog for JSON, key-value structured logs."""
    logging.basicConfig(format="%(message)s", stream=sys.stdout, level=logging.INFO)
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(logging.INFO),
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )


def get_logger(name: str = "nexusbi") -> structlog.stdlib.BoundLogger:
    return structlog.get_logger(name)
