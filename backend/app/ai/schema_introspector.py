"""Read DB schema and format it as LLM context."""
from __future__ import annotations

from typing import Any


async def get_schema(connection_string: str) -> dict[str, list[dict[str, str]]]:
    """Introspect tables and columns from a database connection string."""
    from app.db import engine_pool

    engine = await engine_pool.get_engine(connection_string)
    schema: dict[str, list[dict[str, str]]] = {}
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
