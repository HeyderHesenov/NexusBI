"""AutoML: training quality, prediction robustness, blob confinement, ownership."""
from __future__ import annotations

import pytest
from httpx import AsyncClient

from app.core.exceptions import NexusBIException
from app.services import automl_service


def _regression_rows(n: int = 200) -> list[dict]:
    # revenue ≈ 3*quantity + region effect — learnable, deterministic.
    regions = ["North", "South", "East", "West"]
    return [
        {
            "id": i,
            "quantity": i % 40 + 1,
            "region": regions[i % 4],
            "revenue": 3.0 * (i % 40 + 1) + (i % 4) * 25.0,
        }
        for i in range(n)
    ]


def _classification_rows(n: int = 200) -> list[dict]:
    return [
        {
            "spend": float(i % 100),
            "visits": i % 7,
            "churned": "yes" if (i % 100) < 30 else "no",
        }
        for i in range(n)
    ]


# ─── _fit_sync core ───


def test_fit_regression_learns_and_reports_finite_r2():
    fit = automl_service._fit_sync(_regression_rows(), "revenue")
    assert fit["problem_type"] == "regression"
    assert 0.9 <= fit["metrics"]["r2"] <= 1.0  # near-linear synthetic data
    assert fit["row_count"] == 200
    # id dropped; region one-hot present in final columns
    assert all(not c.lower().startswith("id") for c in fit["feature_columns"])
    assert any(c.startswith("region_") for c in fit["feature_columns"])
    assert fit["importances"] and abs(sum(i["weight"] for i in fit["importances"]) - 1) < 0.05


def test_fit_classification_path():
    fit = automl_service._fit_sync(_classification_rows(), "churned")
    assert fit["problem_type"] == "classification"
    assert fit["metrics"]["accuracy"] > 0.9
    assert "f1_macro" in fit["metrics"]


def test_fit_rejects_missing_target_and_tiny_data():
    with pytest.raises(NexusBIException, match="tapılmadı"):
        automl_service._fit_sync(_regression_rows(), "yox_belə_sütun")
    with pytest.raises(NexusBIException, match="sətir"):
        automl_service._fit_sync(_regression_rows(10), "revenue")


def test_predict_handles_unseen_category_via_reindex():
    fit = automl_service._fit_sync(_regression_rows(), "revenue")
    preds = automl_service._predict_sync(
        fit["blob"],
        fit["feature_columns"],
        [{"quantity": 10, "region": "Mars"}],  # unseen category → all-zero dummies
    )
    assert len(preds) == 1 and isinstance(preds[0], float)


def test_predict_coerces_numeric_strings_to_the_numeric_column():
    # "10" must hit the numeric quantity column, not become a quantity_10 dummy.
    fit = automl_service._fit_sync(_regression_rows(), "revenue")
    as_str = automl_service._predict_sync(
        fit["blob"], fit["feature_columns"], [{"quantity": "10", "region": "North"}]
    )
    as_num = automl_service._predict_sync(
        fit["blob"], fit["feature_columns"], [{"quantity": 10, "region": "North"}]
    )
    assert as_str == as_num


def test_numeric_low_cardinality_target_keeps_numeric_class_labels():
    # rating 1..5 → classification, but predictions stay numbers (not '1.0' strings)
    rows = [{"spend": float(i), "rating": (i % 5) + 1} for i in range(200)]
    fit = automl_service._fit_sync(rows, "rating")
    assert fit["problem_type"] == "classification"
    preds = automl_service._predict_sync(fit["blob"], fit["feature_columns"], [{"spend": 42.0}])
    assert isinstance(preds[0], (int, float))


def test_numeric_as_string_feature_column_is_recovered_not_dropped():
    # A >30-unique numeric column arriving as strings must be coerced, not dropped.
    rows = [
        {"qty_text": str(i % 40 + 1), "revenue": 3.0 * (i % 40 + 1)} for i in range(200)
    ]
    fit = automl_service._fit_sync(rows, "revenue")
    assert "qty_text" in fit["feature_columns"]
    assert fit["metrics"]["r2"] > 0.95


# ─── API flow ───


async def test_train_predict_delete_flow(client: AsyncClient, auth: dict):
    resp = await client.post(
        "/api/v1/automl/train",
        json={"name": "Gəlir modeli", "source_table": "sales", "target_column": "revenue"},
        headers=auth,
    )
    assert resp.status_code == 201, resp.text
    model = resp.json()
    assert model["problem_type"] == "regression"
    assert "model_blob" not in model and "blob" not in model  # blob never leaves the DB
    assert model["metrics"]["r2"] is not None

    listed = (await client.get("/api/v1/automl/models", headers=auth)).json()
    assert any(m["id"] == model["id"] for m in listed)

    pred = await client.post(
        f"/api/v1/automl/models/{model['id']}/predict",
        json={"rows": [{"quantity": 5, "region": "North", "category": "Books"}]},
        headers=auth,
    )
    assert pred.status_code == 200, pred.text
    assert len(pred.json()["predictions"]) == 1

    assert (
        await client.delete(f"/api/v1/automl/models/{model['id']}", headers=auth)
    ).status_code == 204


async def test_predict_rejects_all_empty_row(client: AsyncClient, auth: dict):
    resp = await client.post(
        "/api/v1/automl/train",
        json={"source_table": "sales", "target_column": "revenue"},
        headers=auth,
    )
    model_id = resp.json()["id"]
    bad = await client.post(
        f"/api/v1/automl/models/{model_id}/predict",
        json={"rows": [{}]},
        headers=auth,
    )
    assert bad.status_code == 400
    assert "sahə" in bad.json()["message"]


async def test_train_rejects_non_allowlisted_table(client: AsyncClient, auth: dict):
    for bad in ("users", "sales; DROP TABLE users", "no_table"):
        resp = await client.post(
            "/api/v1/automl/train",
            json={"source_table": bad, "target_column": "revenue"},
            headers=auth,
        )
        assert resp.status_code == 400, bad


async def test_automl_cross_user_isolated(client: AsyncClient, auth: dict):
    resp = await client.post(
        "/api/v1/automl/train",
        json={"source_table": "sales", "target_column": "revenue"},
        headers=auth,
    )
    model_id = resp.json()["id"]
    reg = await client.post(
        "/api/v1/auth/register",
        json={"email": "ml-mate@nexusbi.io", "password": "parol1234", "full_name": "Mate"},
    )
    auth2 = {"Authorization": f"Bearer {reg.json()['access_token']}"}
    assert (
        await client.post(
            f"/api/v1/automl/models/{model_id}/predict",
            json={"rows": [{"quantity": 1}]},
            headers=auth2,
        )
    ).status_code == 404
    assert (
        await client.delete(f"/api/v1/automl/models/{model_id}", headers=auth2)
    ).status_code == 404


async def test_tables_endpoint_lists_demo_schema(client: AsyncClient, auth: dict):
    tables = (await client.get("/api/v1/automl/tables", headers=auth)).json()
    names = {t["name"] for t in tables}
    assert {"sales", "customers"} <= names
    sales = next(t for t in tables if t["name"] == "sales")
    assert any(c["name"] == "revenue" for c in sales["columns"])
