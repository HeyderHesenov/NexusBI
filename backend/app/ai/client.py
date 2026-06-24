"""Shared async OpenAI client and JSON chat helper."""
from __future__ import annotations

import json
import time
from typing import Any

from openai import AsyncOpenAI

from app.config import settings
from app.core.logging import get_logger

log = get_logger("nexusbi.ai")
_client: AsyncOpenAI | None = None


def get_client() -> AsyncOpenAI:
    """Lazily build a singleton AsyncOpenAI client."""
    global _client
    if _client is None:
        # Bound each request so a hung OpenAI call can't stall the pipeline.
        _client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY, timeout=30.0, max_retries=0)
    return _client


async def chat_json(
    system: str,
    user: str,
    *,
    temperature: float = 0.0,
) -> dict[str, Any]:
    """Call the model and parse a JSON object response."""
    started = time.perf_counter()
    resp = await get_client().chat.completions.create(
        model=settings.OPENAI_MODEL,
        temperature=temperature,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    )
    log.info(
        "ai_call",
        model=settings.OPENAI_MODEL,
        tokens_used=getattr(resp.usage, "total_tokens", None),
        latency_ms=int((time.perf_counter() - started) * 1000),
        kind="json",
    )
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
    resp = await get_client().chat.completions.create(
        model=settings.OPENAI_MODEL,
        temperature=temperature,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    )
    log.info(
        "ai_call",
        model=settings.OPENAI_MODEL,
        tokens_used=getattr(resp.usage, "total_tokens", None),
        latency_ms=int((time.perf_counter() - started) * 1000),
        kind="text",
    )
    return (resp.choices[0].message.content or "").strip()
