"""Trust layer: metric verification, query lineage, datasource freshness SLA."""
from __future__ import annotations

import pytest

from app.ai.types import ChartConfig, Text2SQLResult
from app.models.metric import Metric
from app.models.query_log import QueryLog
from app.services import lineage_service, query_service


@pytest.fixture(autouse=True)
def _mock_ai(monkeypatch):
    async def fake_sql(self, nl, schema, dtype="sqlite", extra_context=""):
        return Text2SQLResult(
            sql="SELECT product_name, SUM(revenue) AS total FROM sales GROUP BY product_name",
            explanation="d", confidence=0.9,
        )

    async def fake_chart(columns, data, nl):
        return ChartConfig(chart_type="bar", x_axis="product_name", y_axis="total")

    async def fake_insight(data, nl, chart_type=""):
        return "ok"

    monkeypatch.setattr(query_service.Text2SQLEngine, "generate_sql", fake_sql)
    monkeypatch.setattr(query_service, "select_chart_type", fake_chart)
    monkeypatch.setattr(query_service, "generate_insight", fake_insight)


def test_lineage_extracts_tables_and_metric():
    log = QueryLog(
        natural_language="ümumi gəlir",
        generated_sql="SELECT c.name, SUM(o.revenue) FROM orders o JOIN customers c ON o.cid=c.id",
        result_data={"columns": ["name", "revenue"], "rows": []},
    )
    metric = Metric(name="Gəlir", synonyms="revenue, gəlir", expression="SUM(revenue)")
    out = lineage_service.lineage_for_query(log, [metric])
    assert set(out["tables"]) == {"orders", "customers"}
    assert out["columns"] == ["name", "revenue"]
    assert "Gəlir" in out["metrics"]


async def test_metric_verify_flow(client, auth):
    created = (
        await client.post(
            "/api/v1/metrics/",
            json={"name": "Aktiv istifadəçi", "expression": "COUNT(*)"},
            headers=auth,
        )
    ).json()
    assert created["verified"] is False

    verified = (
        await client.patch(
            f"/api/v1/metrics/{created['id']}/verify", json={"verified": True}, headers=auth
        )
    ).json()
    assert verified["verified"] is True
    assert verified["verified_by"]
    assert verified["verified_at"]

    # Un-verify clears the stamps.
    un = (
        await client.patch(
            f"/api/v1/metrics/{created['id']}/verify", json={"verified": False}, headers=auth
        )
    ).json()
    assert un["verified"] is False
    assert un["verified_by"] is None


async def test_query_lineage_endpoint(client, auth):
    qid = (
        await client.post(
            "/api/v1/query/ask",
            json={"nl_query": "məhsul gəliri", "datasource_id": None},
            headers=auth,
        )
    ).json()["query_log_id"]
    resp = await client.get(f"/api/v1/query/{qid}/lineage", headers=auth)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "sales" in body["tables"]
    assert body["columns"]


async def test_datasource_sla_update(client, auth):
    from tests.conftest import seed_internal_datasource, seed_sqlite_file

    # Raw sqlite DSNs are blocked over the public API, so seed via the trusted
    # internal path (upload/data-prep pipeline), then fetch the created row.
    conn_str = seed_sqlite_file()
    ds_id = await seed_internal_datasource("test@nexusbi.io", "Test PG", conn_str)
    ds = next(
        d
        for d in (await client.get("/api/v1/datasource/", headers=auth)).json()
        if d["id"] == ds_id
    )
    assert ds["last_refreshed_at"]  # stamped at creation

    upd = (
        await client.patch(
            f"/api/v1/datasource/{ds_id}/sla",
            json={"freshness_sla_hours": 24},
            headers=auth,
        )
    ).json()
    assert upd["freshness_sla_hours"] == 24
