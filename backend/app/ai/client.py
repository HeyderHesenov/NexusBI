"""Shared async AI-engine client and JSON chat helper."""
from __future__ import annotations

import json
import time
from typing import Any

from openai import APIError, AsyncOpenAI, OpenAIError

from app.config import settings
from app.core import metrics
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
        _client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY, timeout=30.0, max_retries=2)
    return _client


async def chat_json(
    system: str,
    user: str,
    *,
    temperature: float = 0.0,
) -> dict[str, Any]:
    """Call the model and parse a JSON object response."""
    started = time.perf_counter()
    try:
        resp = await get_client().chat.completions.create(
            model=settings.OPENAI_MODEL,
            temperature=temperature,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        )
    except (APIError, OpenAIError) as exc:
        raise _map_openai_error(exc) from exc
    _record_call(resp, started, "json")
    content = resp.choices[0].message.content or "{}"
    return json.loads(content)


async def chat_text(
    system: str,
    user: str,
    *,
    temperature: float = 0.3,
) -> str:
    """Call the model and return plain text."""
    started = time.perf_counter()
    try:
        resp = await get_client().chat.completions.create(
            model=settings.OPENAI_MODEL,
            temperature=temperature,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        )
    except (APIError, OpenAIError) as exc:
        raise _map_openai_error(exc) from exc
    _record_call(resp, started, "text")
    return (resp.choices[0].message.content or "").strip()


async def chat_tools(
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]],
    *,
    temperature: float = 0.0,
) -> Any:
    """Call the model with tool definitions; return the raw response message.

    The caller drives the tool-calling loop: inspect ``.tool_calls``, execute
    them, append results to ``messages``, and call again until the model replies
    with plain ``.content``. ``messages`` must already include the system prompt.
    """
    started = time.perf_counter()
    try:
        resp = await get_client().chat.completions.create(
            model=settings.OPENAI_MODEL,
            temperature=temperature,
            messages=messages,
            tools=tools,
            tool_choice="auto",
        )
    except (APIError, OpenAIError) as exc:
        raise _map_openai_error(exc) from exc
    _record_call(resp, started, "tools")
    return resp.choices[0].message


def _map_openai_error(exc: Exception) -> AIGenerationError:
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
    tokens = getattr(resp.usage, "total_tokens", None)
    log.info(
        "ai_call",
        model=settings.OPENAI_MODEL,
        tokens_used=tokens,
        latency_ms=int((time.perf_counter() - started) * 1000),
        kind=kind,
    )
    metrics.ai_calls_total.labels(kind).inc()
    if tokens:
        metrics.ai_tokens_total.inc(tokens)
