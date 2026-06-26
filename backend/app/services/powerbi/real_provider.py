"""Real Power BI provider via the REST API (executeQueries / DAX).

Active only when Azure AD credentials are configured (see provider.get_provider).
Not exercised by the test suite — it requires a live Power BI tenant — but is
structured to drop in once credentials are present.
"""
from __future__ import annotations

from typing import Any

import httpx

from app.config import settings
from app.core.exceptions import DataSourceConnectionError
from app.core.logging import get_logger
from app.core.powerbi_auth import get_access_token
from app.services.powerbi.provider import PowerBIProvider

log = get_logger("nexusbi.powerbi")


class RealPowerBIProvider(PowerBIProvider):
    name = "real"

    async def _get(self, path: str) -> dict[str, Any]:
        token = await get_access_token()
        async with httpx.AsyncClient(timeout=30.0) as http:
            resp = await http.get(
                f"{settings.POWERBI_API_BASE}{path}",
                headers={"Authorization": f"Bearer {token}"},
            )
        if resp.status_code != 200:
            raise DataSourceConnectionError("Power BI REST xətası.", detail=resp.text[:200])
        return resp.json()

    async def list_datasets(self) -> list[dict[str, str]]:
        data = await self._get("/datasets")
        return [
            {"id": d["id"], "name": d.get("name", d["id"]), "workspace": ""}
            for d in data.get("value", [])
        ]

    async def get_model_schema(self, dataset_id: str) -> dict[str, list[dict[str, str]]]:
        """Best-effort schema via INFO.VIEW.COLUMNS() (friendly table/column names)."""
        try:
            _cols, rows = await self.execute_dax(dataset_id, "EVALUATE INFO.VIEW.COLUMNS()")
        except DataSourceConnectionError:
            return {}
        schema: dict[str, list[dict[str, str]]] = {}
        for row in rows:
            table = str(row.get("Table") or row.get("[Table]") or "").strip()
            column = str(row.get("Column") or row.get("[Column]") or "").strip()
            dtype = str(row.get("DataType") or row.get("[DataType]") or "")
            if not table or not column:
                continue
            schema.setdefault(table, []).append(
                {"name": column, "type": "NUMERIC" if dtype.lower() in
                 ("int64", "double", "decimal", "currency") else "TEXT"}
            )
        return schema

    async def execute_dax(
        self, dataset_id: str, dax_query: str
    ) -> tuple[list[str], list[dict[str, Any]]]:
        token = await get_access_token()
        body = {
            "queries": [{"query": dax_query}],
            "serializerSettings": {"includeNulls": True},
        }
        async with httpx.AsyncClient(timeout=60.0) as http:
            resp = await http.post(
                f"{settings.POWERBI_API_BASE}/datasets/{dataset_id}/executeQueries",
                headers={"Authorization": f"Bearer {token}"},
                json=body,
            )
        if resp.status_code != 200:
            raise DataSourceConnectionError("DAX icra olunmadı.", detail=resp.text[:200])
        # A 200 can still carry an empty results/tables array — guard every hop.
        results = resp.json().get("results") or []
        tables = (results[0].get("tables") if results else None) or []
        raw_rows = (tables[0].get("rows") if tables else None) or []
        rows = [_strip_table_prefix(r) for r in raw_rows]
        columns = list(rows[0].keys()) if rows else []
        return columns, rows[: settings.POWERBI_MAX_ROWS]


def _strip_table_prefix(row: dict[str, Any]) -> dict[str, Any]:
    """Power BI returns keys like "Sales[category]" / "[Measure]" — keep the leaf."""
    out: dict[str, Any] = {}
    for key, value in row.items():
        name = key
        if "[" in key and key.endswith("]"):
            name = key[key.index("[") + 1: -1]
        out[name] = value
    return out
