"""Natural language -> DAX engine backed by OpenAI.

Mirrors text2sql.py, but emits the constrained DAX subset the mock provider can
execute. Each candidate is validated by translating it to SQL (dax_to_sql); on
failure the error is fed back for a retry, same as the SQL path.
"""
from __future__ import annotations

import asyncio
import json

from app.ai.client import chat_json
from app.ai.prompt_templates import TEXT2DAX_SYSTEM_PROMPT, TEXT2DAX_USER_PROMPT
from app.ai.types import DAXResult
from app.core.exceptions import AIGenerationError, InvalidSQLError
from app.services.powerbi import dax


class Text2DAXEngine:
    """Generates a validated, executable DAX query from natural language."""

    def __init__(self, max_retries: int = 3) -> None:
        self.max_retries = max_retries

    async def generate_dax(
        self, nl_query: str, model_schema: str, extra_context: str = ""
    ) -> DAXResult:
        system = TEXT2DAX_SYSTEM_PROMPT
        context = f"\n{extra_context}\n" if extra_context else "\n"
        user = TEXT2DAX_USER_PROMPT.format(
            schema=model_schema, context=context, nl_query=nl_query
        )

        last_error: Exception | None = None
        for attempt in range(self.max_retries):
            try:
                raw = await chat_json(system, user)
                result = DAXResult(**raw)
                dax.dax_to_sql(result.dax)  # validate it is executable
                return result
            except InvalidSQLError as exc:
                last_error = exc
                user = (
                    f"{user}\n\nƏVVƏLKİ XƏTA: {exc.message}. "
                    "Yalnız icazə verilən DAX altçoxluğundan istifadə et."
                )
            except (json.JSONDecodeError, ValueError, TypeError) as exc:
                last_error = exc
            if attempt < self.max_retries - 1:
                await asyncio.sleep(0.5 * (2**attempt))

        raise AIGenerationError(
            "DAX generasiyası alınmadı.",
            detail=str(last_error) if last_error else None,
        )
