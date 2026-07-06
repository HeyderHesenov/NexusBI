"""Natural language -> SQL engine backed by the AI layer."""
from __future__ import annotations

import asyncio
import json

from app.ai.client import chat_json
from app.ai.prompt_templates import (
    SQL_REPAIR_SYSTEM_PROMPT,
    SQL_REPAIR_USER_PROMPT,
    TEXT2SQL_SYSTEM_PROMPT,
    TEXT2SQL_USER_PROMPT,
)
from app.ai.sql_guard import validate_select_only
from app.ai.types import Text2SQLResult
from app.core.exceptions import AIGenerationError, InvalidSQLError

_REPAIR_RETRIES = 2  # inner JSON/validation retries per repair call (kept small on purpose)


class Text2SQLEngine:
    """Generates validated SELECT SQL from natural language."""

    def __init__(self, max_retries: int = 3) -> None:
        self.max_retries = max_retries

    async def generate_sql(
        self,
        nl_query: str,
        schema: str,
        datasource_type: str = "sqlite",
        extra_context: str = "",
    ) -> Text2SQLResult:
        system = TEXT2SQL_SYSTEM_PROMPT.format(dialect=datasource_type)
        context = f"\n{extra_context}\n" if extra_context else "\n"
        user = TEXT2SQL_USER_PROMPT.format(schema=schema, context=context, nl_query=nl_query)

        last_error: Exception | None = None
        for attempt in range(self.max_retries):
            try:
                raw = await chat_json(system, user)
                result = Text2SQLResult(**raw)
                result.sql = validate_select_only(result.sql)
                return result
            except InvalidSQLError as exc:
                last_error = exc
                user = (
                    f"{user}\n\nƏVVƏLKİ XƏTA: {exc.message}. "
                    "Yalnız təhlükəsiz SELECT sorğusu qaytar."
                )
            except (json.JSONDecodeError, ValueError, TypeError) as exc:
                last_error = exc
            if attempt < self.max_retries - 1:
                await asyncio.sleep(0.5 * (2**attempt))

        raise AIGenerationError(
            "SQL generasiyası alınmadı.",
            detail=str(last_error) if last_error else None,
        )

    async def repair_sql(
        self,
        nl_query: str,
        failed_sql: str,
        db_error: str,
        schema: str,
        datasource_type: str = "sqlite",
        extra_context: str = "",
    ) -> Text2SQLResult:
        """Regenerate SQL after an execution error, feeding the DB error + failed SQL
        back to the model. Bounded to _REPAIR_RETRIES inner tries (fewer than
        generate_sql) so the per-query LLM-call ceiling stays modest even across
        multiple outer repair attempts. Raises on exhaustion."""
        system = SQL_REPAIR_SYSTEM_PROMPT.format(dialect=datasource_type)
        context = f"\n{extra_context}\n" if extra_context else "\n"
        user = SQL_REPAIR_USER_PROMPT.format(
            schema=schema, context=context, nl_query=nl_query,
            failed_sql=failed_sql, db_error=db_error,
        )

        retries = min(self.max_retries, _REPAIR_RETRIES)
        last_error: Exception | None = None
        for attempt in range(retries):
            try:
                raw = await chat_json(system, user)
                result = Text2SQLResult(**raw)
                result.sql = validate_select_only(result.sql)
                return result
            except InvalidSQLError as exc:
                last_error = exc
                user = (
                    f"{user}\n\nƏVVƏLKİ XƏTA: {exc.message}. "
                    "Yalnız təhlükəsiz SELECT sorğusu qaytar."
                )
            except (json.JSONDecodeError, ValueError, TypeError) as exc:
                last_error = exc
            if attempt < retries - 1:
                await asyncio.sleep(0.5 * (2**attempt))

        raise AIGenerationError(
            "SQL düzəlişi alınmadı.",
            detail=str(last_error) if last_error else None,
        )
