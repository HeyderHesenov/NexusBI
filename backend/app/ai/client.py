"""Shared async OpenAI client and JSON chat helper."""
from __future__ import annotations

import json
from typing import Any

from openai import AsyncOpenAI

from app.config import settings

_client: AsyncOpenAI | None = None


def get_client() -> AsyncOpenAI:
    """Lazily build a singleton AsyncOpenAI client."""
    global _client
    if _client is None:
        _client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
    return _client


async def chat_json(
    system: str,
    user: str,
    *,
    temperature: float = 0.0,
) -> dict[str, Any]:
    """Call the model and parse a JSON object response."""
    resp = await get_client().chat.completions.create(
        model=settings.OPENAI_MODEL,
        temperature=temperature,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
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
    resp = await get_client().chat.completions.create(
        model=settings.OPENAI_MODEL,
        temperature=temperature,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    )
    return (resp.choices[0].message.content or "").strip()
