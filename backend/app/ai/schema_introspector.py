"""Read DB schema and format it as LLM context, with Redis caching."""
from __future__ import annotations

import json
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

_SCHEMA_CACHE_TTL = 3600


async def get_schema(connection_string: str) -> dict[str, list[dict[str, str]]]:
    """Introspect tables and columns from a database connection string."""
    engine = create_async_engine(connection_string)
    schema: dict[str, list[dict[str, str]]] = {}
    try:
        async with engine.connect() as conn:
            def _inspect(sync_conn: Any) -> dict[str, list[dict[str, str]]]:
                from sqlalchemy import inspect

                inspector = inspect(sync_conn)
                out: dict[str, list[dict[str, str]]] = {}
                for table in inspector.get_table_names():
                    out[table] = [
                        {"name": col["name"], "type": str(col["type"])}
                        for col in inspector.get_columns(table)
                    ]
                return out

            schema = await conn.run_sync(_inspect)
    finally:
        await engine.dispose()
    return schema


def format_schema_for_prompt(schema: dict[str, Any]) -> str:
    """Render a schema dict into compact text for the prompt."""
    lines: list[str] = []
    for table, columns in schema.items():
        if columns and isinstance(columns[0], dict):
            cols = ", ".join(f"{c['name']} ({c.get('type', '?')})" for c in columns)
        else:
            cols = ", ".join(str(c) for c in columns)
        lines.append(f"- {table}({cols})")
    return "\n".join(lines)


async def cache_schema(datasource_id: str, schema: dict[str, Any], redis_client: Any) -> None:
    if redis_client is None:
        return
    await redis_client.set(
        f"schema:{datasource_id}", json.dumps(schema), ex=_SCHEMA_CACHE_TTL
    )


async def get_cached_schema(datasource_id: str, redis_client: Any) -> dict[str, Any] | None:
    if redis_client is None:
        return None
    raw = await redis_client.get(f"schema:{datasource_id}")
    return json.loads(raw) if raw else None
