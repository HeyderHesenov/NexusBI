"""Prometheus metrics — low-cardinality counters/histograms for observability."""
from __future__ import annotations

from prometheus_client import Counter, Histogram

http_requests_total = Counter(
    "nexusbi_http_requests_total",
    "HTTP requests",
    ["method", "route", "status"],
)
http_request_duration_seconds = Histogram(
    "nexusbi_http_request_duration_seconds",
    "HTTP request latency",
    ["method", "route"],
)
ai_calls_total = Counter(
    "nexusbi_ai_calls_total",
    "AI engine chat calls",
    ["kind"],
)
ai_tokens_total = Counter(
    "nexusbi_ai_tokens_total",
    "AI engine tokens consumed",
)
sql_executions_total = Counter(
    "nexusbi_sql_executions_total",
    "Datasource SQL executions",
    ["status"],
)
