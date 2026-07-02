"""Shared async AI-engine client and JSON chat helper."""
from __future__ import annotations

import json
import time
from typing import Any

from openai import APIError, AsyncOpenAI, OpenAIError

from app.config import settings
from app.core import i18n, metrics
from app.core.exceptions import AIGenerationError
from app.core.logging import get_logger

log = get_logger("nexusbi.ai")
_client: AsyncOpenAI | None = None


def get_client() -> AsyncOpenAI:
    """Lazily build a singleton async AI-engine client."""
    global _client
    if _client is None:
        # Bound each request so a hung AI call can't stall the pipeline.
        # max_retries lets the SDK ride out transient 429/5xx with backoff;
        # auth errors (401) are not retried by the SDK, so they still fail fast.
        _client = AsyncOpenAI(api_key=settings.AI_API_KEY, timeout=30.0, max_retries=2)
    return _client


async def chat_json(
    system: str,
    user: str,
    *,
    temperature: float = 0.0,
    localize: bool = False,
) -> dict[str, Any]:
    """Call the model and parse a JSON object response.

    ``localize=True`` appends a language directive so natural-language text in the
    response follows the request language (JSON keys/SQL stay unchanged). Leave it
    False for structured generators (Text2SQL/DAX/chart) whose output is not prose.
    """
    if localize:
        system = system + i18n.lang_directive()
    started = time.perf_counter()
    try:
        resp = await get_client().chat.completions.create(
            model=settings.AI_MODEL,
            temperature=temperature,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        )
    except (APIError, OpenAIError) as exc:
        raise _map_ai_error(exc) from exc
    _record_call(resp, started, "json")
    content = resp.choices[0].message.content or "{}"
    return json.loads(content)


async def chat_text(
    system: str,
    user: str,
    *,
    temperature: float = 0.3,
    localize: bool = True,
) -> str:
    """Call the model and return plain text. Prose by nature → localizes by default."""
    if localize:
        system = system + i18n.lang_directive()
    started = time.perf_counter()
    try:
        resp = await get_client().chat.completions.create(
            model=settings.AI_MODEL,
            temperature=temperature,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        )
    except (APIError, OpenAIError) as exc:
        raise _map_ai_error(exc) from exc
    _record_call(resp, started, "text")
    return (resp.choices[0].message.content or "").strip()


async def chat_tools(
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]],
    *,
    temperature: float = 0.0,
    localize: bool = False,
) -> Any:
    """Call the model with tool definitions; return the raw response message.

    The caller drives the tool-calling loop: inspect ``.tool_calls``, execute
    them, append results to ``messages``, and call again until the model replies
    with plain ``.content``. ``messages`` must already include the system prompt.
    """
    if localize:
        directive = i18n.lang_directive()
        if directive:
            messages = [*messages, {"role": "system", "content": directive.strip()}]
    started = time.perf_counter()
    try:
        resp = await get_client().chat.completions.create(
            model=settings.AI_MODEL,
            temperature=temperature,
            messages=messages,
            tools=tools,
            tool_choice="auto",
        )
    except (APIError, OpenAIError) as exc:
        raise _map_ai_error(exc) from exc
    _record_call(resp, started, "tools")
    return resp.choices[0].message


async def embed(texts: list[str]) -> list[list[float]]:
    """Embed texts for the RAG vector layer.

    Uses the real embedding model when a key is configured; otherwise falls back
    to a deterministic hash embedding so demo / CI / keyless runs still index and
    retrieve (lower quality, but functional and offline — mirrors rule_based_sql).
    """
    if not texts:
        return []
    if not settings.AI_API_KEY or not settings.EMBEDDING_MODEL:
        return [_hash_embed(t) for t in texts]
    started = time.perf_counter()
    try:
        resp = await get_client().embeddings.create(model=settings.EMBEDDING_MODEL, input=texts)
    except (APIError, OpenAIError) as exc:
        # Don't fail the caller — degrade to the offline embedding.
        log.warning("embed_fallback", error=type(exc).__name__, detail=str(exc)[:200])
        return [_hash_embed(t) for t in texts]
    _record_call(resp, started, "embed")
    return [d.embedding for d in resp.data]


def _hash_embed(text: str) -> list[float]:
    """Deterministic bag-of-hashed-tokens embedding, L2-normalised. Offline fallback."""
    import math
    import re

    dim = settings.RAG_HASH_DIM
    vec = [0.0] * dim
    for tok in re.findall(r"\w+", text.lower()):
        vec[hash_token(tok) % dim] += 1.0
    norm = math.sqrt(sum(v * v for v in vec))
    return [v / norm for v in vec] if norm else vec


def hash_token(tok: str) -> int:
    """Stable (non-salted) token hash — hashlib so it survives process restarts."""
    import hashlib

    return int.from_bytes(hashlib.sha1(tok.encode()).digest()[:8], "big")


def _map_ai_error(exc: Exception) -> AIGenerationError:
    """Convert a raw AI-SDK error into a domain error with a safe detail.

    Keeps the upstream message short so the client gets an actionable 502 instead
    of a generic 500, without leaking keys or full payloads.
    """
    detail = str(exc)
    if len(detail) > 200:
        detail = detail[:200] + "…"
    log.warning("ai_error", error=type(exc).__name__, detail=detail)
    return AIGenerationError("AI xidməti əlçatmazdır.", detail=detail)


def _record_call(resp: Any, started: float, kind: str) -> None:
    """Log + count an AI call and its token usage."""
    elapsed = time.perf_counter() - started
    tokens = getattr(getattr(resp, "usage", None), "total_tokens", None)
    log.info(
        "ai_call",
        model=settings.AI_MODEL,
        tokens_used=tokens,
        latency_ms=int(elapsed * 1000),
        kind=kind,
    )
    metrics.ai_calls_total.labels(kind).inc()
    metrics.ai_latency_seconds.labels(kind).observe(elapsed)
    if tokens:
        metrics.ai_tokens_total.inc(tokens)
    if settings.AI_TRACE_ENABLED:
        _trace(kind, tokens, elapsed)


# In-process rolling AI-call trace (bounded) — powers the AI Quality observability
# view without a DB write on every call. Reset on restart; that's acceptable for
# an at-a-glance health panel.
_TRACE: list[dict[str, Any]] = []
_TRACE_MAX = 500


def _trace(kind: str, tokens: int | None, elapsed: float) -> None:
    _TRACE.append({"kind": kind, "tokens": tokens or 0, "latency_ms": int(elapsed * 1000)})
    if len(_TRACE) > _TRACE_MAX:
        del _TRACE[: len(_TRACE) - _TRACE_MAX]


def observability() -> dict[str, Any]:
    """Aggregate the rolling trace for the AI Quality view."""
    if not _TRACE:
        return {"calls": 0, "total_tokens": 0, "avg_latency_ms": 0, "by_kind": {}}
    by_kind: dict[str, int] = {}
    for t in _TRACE:
        by_kind[t["kind"]] = by_kind.get(t["kind"], 0) + 1
    return {
        "calls": len(_TRACE),
        "total_tokens": sum(t["tokens"] for t in _TRACE),
        "avg_latency_ms": round(sum(t["latency_ms"] for t in _TRACE) / len(_TRACE), 1),
        "by_kind": by_kind,
    }
