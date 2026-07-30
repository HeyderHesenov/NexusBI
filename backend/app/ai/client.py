"""Shared async AI-engine client and JSON chat helper."""
from __future__ import annotations

import json
import time
from typing import Any

from openai import APIError, AsyncOpenAI, OpenAIError

from app.billing import cost
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


async def _preflight() -> None:
    """Refuse the call before it reaches the network, for either reason.

    Callers already treat ``AIGenerationError`` as "take the deterministic path",
    so a keyless run lands on the same fallback either way — but reaching it via
    the SDK costs a connection attempt plus ``max_retries`` backoff *per call*.
    A DEMO_MODE seed makes dozens of those, which is what pushed CI's readiness
    budget over the edge: the backend answered /ready seconds after the wait loop
    had already given up. ``embed`` has guarded this since it was written; the
    completion paths simply never did.

    An exhausted daily budget raises the *same* error, deliberately: the product
    already knows how to run without a model, so the breaker reuses that path
    rather than inventing a second kind of degradation to test and maintain.
    """
    if not settings.AI_API_KEY or not settings.AI_MODEL:
        raise AIGenerationError("AI xidməti əlçatmazdır.")
    if await cost.over_ceiling():
        raise AIGenerationError("AI xidməti əlçatmazdır.")


async def chat_json(
    system: str,
    user: str,
    *,
    temperature: float = 0.0,
    localize: bool = False,
    feature: str = "unknown",
) -> dict[str, Any]:
    """Call the model and parse a JSON object response.

    ``localize=True`` appends a language directive so natural-language text in the
    response follows the request language (JSON keys/SQL stay unchanged). Leave it
    False for structured generators (Text2SQL/DAX/chart) whose output is not prose.
    """
    await _preflight()
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
    await _record_call(resp, started, "json", feature)
    content = resp.choices[0].message.content or "{}"
    return json.loads(content)


async def chat_text(
    system: str,
    user: str,
    *,
    temperature: float = 0.3,
    localize: bool = True,
    feature: str = "unknown",
) -> str:
    """Call the model and return plain text. Prose by nature → localizes by default."""
    await _preflight()
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
    await _record_call(resp, started, "text", feature)
    return (resp.choices[0].message.content or "").strip()


async def chat_tools(
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]],
    *,
    temperature: float = 0.0,
    localize: bool = False,
    feature: str = "unknown",
) -> Any:
    """Call the model with tool definitions; return the raw response message.

    The caller drives the tool-calling loop: inspect ``.tool_calls``, execute
    them, append results to ``messages``, and call again until the model replies
    with plain ``.content``. ``messages`` must already include the system prompt.
    """
    await _preflight()
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
    await _record_call(resp, started, "tools", feature)
    return resp.choices[0].message


async def embed(texts: list[str], *, feature: str = "unknown") -> list[list[float]]:
    """Embed texts for the RAG vector layer.

    Uses the real embedding model when a key is configured; otherwise falls back
    to a deterministic hash embedding so demo / CI / keyless runs still index and
    retrieve (lower quality, but functional and offline — mirrors rule_based_sql).
    """
    if not texts:
        return []
    if (
        not settings.AI_API_KEY
        or not settings.EMBEDDING_MODEL
        or await cost.over_ceiling()
    ):
        return [_hash_embed(t) for t in texts]
    started = time.perf_counter()
    try:
        resp = await get_client().embeddings.create(model=settings.EMBEDDING_MODEL, input=texts)
    except (APIError, OpenAIError) as exc:
        # Don't fail the caller — degrade to the offline embedding.
        log.warning("embed_fallback", error=type(exc).__name__, detail=str(exc)[:200])
        return [_hash_embed(t) for t in texts]
    await _record_call(resp, started, "embed", feature, embedding=True)
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
    """Stable (non-salted) token hash — hashlib so it survives process restarts.

    Deliberately still SHA-1, unlike the cache keys. This is not a digest of
    anything sensitive; it picks a bucket in the hashed-embedding vector, so the
    algorithm is part of the stored data format. Changing it silently reindexes
    nothing and makes every persisted embedding mismatch fresh query vectors.
    """
    import hashlib

    return int.from_bytes(hashlib.sha1(tok.encode()).digest()[:8], "big")


def _map_ai_error(exc: Exception) -> AIGenerationError:
    """Convert a raw AI-engine error into a domain error.

    The upstream message can embed the engine/model identity, org id, or a masked
    key fragment, so it is kept to server logs only and never surfaced to the
    client — the caller gets a generic 502 with no ``detail``.
    """
    detail = str(exc)
    if len(detail) > 200:
        detail = detail[:200] + "…"
    log.warning("ai_error", error=type(exc).__name__, detail=detail)
    return AIGenerationError("AI xidməti əlçatmazdır.")


async def _record_call(
    resp: Any, started: float, kind: str, feature: str, *, embedding: bool = False
) -> None:
    """Log, count and cost an AI call.

    The one place every model call passes through on its way out, which is why
    spend accounting lives here rather than at each of the dozen call sites.
    """
    elapsed = time.perf_counter() - started
    usage = getattr(resp, "usage", None)
    prompt_tokens = getattr(usage, "prompt_tokens", 0) or 0
    completion_tokens = getattr(usage, "completion_tokens", 0) or 0
    tokens = getattr(usage, "total_tokens", None)
    log.info(
        "ai_call",
        model=settings.AI_MODEL,
        tokens_used=tokens,
        latency_ms=int(elapsed * 1000),
        kind=kind,
        feature=feature,
    )
    metrics.ai_calls_total.labels(kind).inc()
    metrics.ai_latency_seconds.labels(kind).observe(elapsed)
    if tokens:
        metrics.ai_tokens_total.inc(tokens)
    await cost.record(
        feature, settings.AI_MODEL, prompt_tokens, completion_tokens, embedding=embedding
    )
