"""A sample Power BI semantic model used by the mock provider.

Mirrors the demo tables (sales / customers / products) as a Power BI tabular
model so the mock can answer DAX without a real Power BI workspace. The DAX
table names map 1:1 (case-insensitively) onto the demo SQLite tables, so a
translated DAX query executes via ``demo_data.execute_demo_sql``.
"""
from __future__ import annotations

from typing import Any

# DAX table name -> (sqlite table, columns, numeric/measure columns).
MODEL_TABLES: dict[str, dict[str, Any]] = {
    "Sales": {
        "sqlite": "sales",
        "columns": ["id", "product_name", "category", "revenue", "quantity", "sale_date", "region"],
        "measures": ["revenue", "quantity"],
    },
    "Customers": {
        "sqlite": "customers",
        "columns": ["id", "name", "email", "country", "signup_date", "total_spent"],
        "measures": ["total_spent"],
    },
    "Products": {
        "sqlite": "products",
        "columns": ["id", "name", "category", "price", "stock_quantity"],
        "measures": ["price", "stock_quantity"],
    },
}

# A single sample dataset inside a sample workspace.
SAMPLE_DATASETS: list[dict[str, str]] = [
    {
        "id": "sales-model",
        "name": "Sales Model",
        "workspace": "Demo Workspace",
        "workspace_id": "demo-workspace",
    }
]

_SQLITE_BY_DAX = {name: meta["sqlite"] for name, meta in MODEL_TABLES.items()}
_DAX_BY_LOWER = {name.lower(): name for name in MODEL_TABLES}


def list_datasets() -> list[dict[str, str]]:
    return [dict(d) for d in SAMPLE_DATASETS]


def is_known_dataset(dataset_id: str) -> bool:
    return any(d["id"] == dataset_id for d in SAMPLE_DATASETS)


def sqlite_table(dax_table: str) -> str | None:
    """Map a DAX table name ('Sales') to its sqlite table ('sales')."""
    canonical = _DAX_BY_LOWER.get(dax_table.strip().strip("'").lower())
    return _SQLITE_BY_DAX.get(canonical) if canonical else None


def get_model_schema(dataset_id: str) -> dict[str, list[dict[str, str]]]:
    """Schema dict in the same shape as ``schema_introspector.get_schema``."""
    return {
        name: [{"name": col, "type": "NUMERIC" if col in meta["measures"] else "TEXT"}
               for col in meta["columns"]]
        for name, meta in MODEL_TABLES.items()
    }


def format_model_for_dax_prompt(dataset_id: str) -> str:
    """Render the model as Power BI tables/columns for the NL->DAX prompt."""
    lines: list[str] = []
    for name, meta in MODEL_TABLES.items():
        cols = ", ".join(meta["columns"])
        measures = ", ".join(meta["measures"])
        lines.append(f"- Table '{name}': columns [{cols}] | numeric (measures): [{measures}]")
    return "\n".join(lines)
