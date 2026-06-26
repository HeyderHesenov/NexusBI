"""Power BI provider abstraction: a mock (default) and a real Azure-backed one.

``get_provider()`` returns the real provider only when Azure AD credentials are
configured; otherwise the mock answers DAX locally against the sample model so
the feature is fully demonstrable without a Power BI license.
"""
from __future__ import annotations

import abc
from typing import Any

from app.config import settings
from app.core.logging import get_logger
from app.services.powerbi import dax, sample_model

log = get_logger("nexusbi.powerbi")


class PowerBIProvider(abc.ABC):
    """Minimal surface NexusBI needs from Power BI."""

    name: str = "base"

    @abc.abstractmethod
    async def list_datasets(self) -> list[dict[str, str]]:
        ...

    @abc.abstractmethod
    async def get_model_schema(self, dataset_id: str) -> dict[str, list[dict[str, str]]]:
        ...

    @abc.abstractmethod
    async def execute_dax(
        self, dataset_id: str, dax_query: str
    ) -> tuple[list[str], list[dict[str, Any]]]:
        ...


class MockPowerBIProvider(PowerBIProvider):
    """Answers DAX against the local sample model (no Azure needed)."""

    name = "mock"

    async def list_datasets(self) -> list[dict[str, str]]:
        return sample_model.list_datasets()

    async def get_model_schema(self, dataset_id: str) -> dict[str, list[dict[str, str]]]:
        return sample_model.get_model_schema(dataset_id)

    async def execute_dax(
        self, dataset_id: str, dax_query: str
    ) -> tuple[list[str], list[dict[str, Any]]]:
        # Reuse the demo SQLite executor: the sample model tables ARE the demo
        # tables, so the translated SQL runs as-is (and is SELECT-guarded there).
        from app.db import demo_data

        sql = dax.dax_to_sql(dax_query)
        log.info("powerbi_mock_execute", dataset_id=dataset_id, sql=sql)
        return demo_data.execute_demo_sql(sql)


def get_provider() -> PowerBIProvider:
    """Real provider when Azure creds are set, else the mock."""
    if settings.POWERBI_CLIENT_ID and settings.POWERBI_CLIENT_SECRET and settings.POWERBI_TENANT_ID:
        from app.services.powerbi.real_provider import RealPowerBIProvider

        return RealPowerBIProvider()
    return MockPowerBIProvider()
