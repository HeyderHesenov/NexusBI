"""Prometheus metrics — low-cardinality counters/histograms for observability."""
from __future__ import annotations

from prometheus_client import Counter, Gauge, Histogram

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
ai_latency_seconds = Histogram(
    "nexusbi_ai_latency_seconds",
    "AI engine call latency",
    ["kind"],
)
rag_retrievals_total = Counter(
    "nexusbi_rag_retrievals_total",
    "RAG context retrievals by outcome",
    ["outcome"],  # hit | miss
)
# Spend, labelled by the feature that made the call — the number that decides
# whether the tier prices are right, and the one to alert on before the ceiling
# cuts AI over to its deterministic paths.
ai_cost_usd_total = Counter(
    "nexusbi_ai_cost_usd_total",
    "AI engine spend in USD",
    ["feature"],
)
ai_budget_remaining_usd = Gauge(
    "nexusbi_ai_budget_remaining_usd",
    "USD left under today's AI spend ceiling",
)
