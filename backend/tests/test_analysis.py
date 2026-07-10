"""Anomaly + forecast endpoint tests — both are deterministic statistics (no AI)."""
from __future__ import annotations

import pytest
from httpx import AsyncClient

from app.ai.types import ChartConfig, Text2SQLResult
from app.services import query_service


@pytest.fixture(autouse=True)
def _mock_ai(monkeypatch):
    async def fake_sql(self, nl, schema, dtype="sqlite", extra_context=""):
        return Text2SQLResult(
            sql="SELECT product_name, SUM(revenue) AS total FROM sales "
                "GROUP BY product_name ORDER BY total DESC LIMIT 5",
            explanation="d", confidence=0.9,
        )

    async def fake_chart(columns, data, nl):
        return ChartConfig(chart_type="bar", x_axis="product_name", y_axis="total")

    async def fake_insight(data, nl, chart_type=""):
        return "ok"

    monkeypatch.setattr(query_service.Text2SQLEngine, "generate_sql", fake_sql)
    monkeypatch.setattr(query_service, "select_chart_type", fake_chart)
    monkeypatch.setattr(query_service, "generate_insight", fake_insight)


async def _make_query(client: AsyncClient, auth: dict) -> str:
    resp = await client.post(
        "/api/v1/query/ask",
        json={"nl_query": "Ən çox satan məhsullar", "datasource_id": None},
        headers=auth,
    )
    return resp.json()["query_log_id"]


async def test_multivariate_isolation_forest_flags_joint_outlier():
    """A point normal in each column but abnormal jointly is caught only by the
    multivariate pass — MAD on the value column alone can't see it."""
    from app.ai import analysis

    columns = ["label", "x", "y"]
    rows = [{"label": f"r{i}", "x": 10.0 + (i % 3) * 0.1, "y": 10.0 + (i % 3) * 0.1} for i in range(15)]
    # x stays in-cluster (univariate MAD on x won't flag it) but y is far out.
    rows.append({"label": "joint", "x": 10.1, "y": 90.0})

    result = await analysis.detect_anomalies(columns, rows, "test")
    assert result["method"] == "mad+isolation_forest"
    assert "joint" in {a["label"] for a in result["anomalies"]}
    # No internal bookkeeping leaks into the response points.
    assert all("index" not in a for a in result["anomalies"])


async def test_single_numeric_column_stays_mad():
    """One numeric column → no IsolationForest, method stays the robust MAD default."""
    from app.ai import analysis

    columns = ["label", "x"]
    rows = [{"label": f"r{i}", "x": 10.0} for i in range(15)]
    result = await analysis.detect_anomalies(columns, rows, "test")
    assert result["method"] == "mad"


async def test_anomalies_endpoint(client, auth):
    """No AI mock — anomaly flagging is a deterministic MAD z-score."""
    qid = await _make_query(client, auth)
    resp = await client.post(f"/api/v1/query/{qid}/anomalies", headers=auth)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["value_col"] == "total"
    assert isinstance(body["anomalies"], list)
    assert body["summary"]  # always an honest summary, even when none found
    for a in body["anomalies"]:
        assert a["severity"] in {"high", "medium", "low"}


async def test_forecast_endpoint(client, auth):
    """No AI mock — forecast is a deterministic trend model with an interval."""
    qid = await _make_query(client, auth)
    resp = await client.post(
        f"/api/v1/query/{qid}/forecast", json={"periods": 3}, headers=auth
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body["forecast"]) == 3
    assert len(body["history"]) == 5
    assert body["method"]
    for p in body["forecast"]:
        assert p["lower"] <= p["value"] <= p["upper"]  # value sits inside its interval
