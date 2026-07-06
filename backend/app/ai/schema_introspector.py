"""Read DB schema and format it as LLM context."""
from __future__ import annotations

from typing import Any

_SAMPLE_PER_COL = 3


async def get_schema(connection_string: str) -> dict[str, list[dict[str, str]]]:
    """Introspect tables + columns, enriched with foreign-key relationships. FK hints
    fix wrong JOINs — the single most common NL→SQL failure mode. Enrichment is
    best-effort (catalog metadata only) so a table that can't be inspected degrades
    to bare name+type.

    NOTE: we deliberately do NOT sample row VALUES here. The schema is cached per
    datasource and shared across viewers, so caching real cell values would leak
    RLS-protected rows into other viewers' generation prompts. Sample-value hints
    come only from the (synthetic, safe) demo schema, rendered by `_fmt_col`.
    """
    from app.db import engine_pool

    engine = await engine_pool.get_engine(connection_string)
    schema: dict[str, list[dict[str, str]]] = {}
    async with engine.connect() as conn:
        def _inspect(sync_conn: Any) -> dict[str, list[dict[str, str]]]:
            from sqlalchemy import inspect

            inspector = inspect(sync_conn)
            out: dict[str, list[dict[str, str]]] = {}
            for table in inspector.get_table_names():
                cols: list[dict[str, str]] = [
                    {"name": col["name"], "type": str(col["type"])}
                    for col in inspector.get_columns(table)
                ]
                by_name = {c["name"]: c for c in cols}

                # Foreign keys → attach "referred_table.referred_col" to the FK column.
                try:
                    for fk in inspector.get_foreign_keys(table):
                        rt = fk.get("referred_table")
                        constrained = fk.get("constrained_columns") or []
                        referred = fk.get("referred_columns") or []
                        for i, col_name in enumerate(constrained):
                            col = by_name.get(col_name)
                            if col is None or not rt:
                                continue
                            # Composite FK with mismatched lengths → skip the ambiguous
                            # extra columns rather than mislabel them all to referred[0].
                            if i >= len(referred):
                                continue
                            col["references"] = f"{rt}.{referred[i]}"
                except Exception:  # noqa: BLE001 — FK introspection is best-effort
                    pass

                out[table] = cols
            return out

        schema = await conn.run_sync(_inspect)
    return schema


def _fmt_col(c: dict[str, Any]) -> str:
    """`name (TYPE)` + FK relationship + a few sample values when available — the
    reference hint fixes JOINs, the value hints (demo schema only) fix filter literals."""
    base = f"{c['name']} ({c.get('type', '?')})"
    ref = c.get("references")
    if ref:
        base = f"{base} → {ref}"
    samples = c.get("samples") or []
    if samples:
        shown = ", ".join(str(s) for s in samples[:_SAMPLE_PER_COL])
        return f"{base} e.g. {shown}"
    return base


def format_schema_for_prompt(schema: dict[str, Any]) -> str:
    """Render a schema dict into compact text for the prompt."""
    lines: list[str] = []
    for table, columns in schema.items():
        if columns and isinstance(columns[0], dict):
            cols = ", ".join(_fmt_col(c) for c in columns)
        else:
            cols = ", ".join(str(c) for c in columns)
        lines.append(f"- {table}({cols})")
    return "\n".join(lines)
