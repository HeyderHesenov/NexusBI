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


def test_fit_regression_diagnostics_and_leaderboard():
    fit = automl_service._fit_sync(_regression_rows(), "revenue")
    # Leaderboard lists every candidate, exactly one flagged best.
    lb = fit["leaderboard"]
    assert {e["algo"] for e in lb} == {"linear_regression", "random_forest"}
    assert sum(1 for e in lb if e["is_best"]) == 1
    diag = fit["diagnostics"]
    # k-fold CV of the winner.
    assert diag["cv"]["metric"] == "r2" and diag["cv"]["folds"] >= 2
    assert len(diag["cv"]["scores"]) == diag["cv"]["folds"]
    # Regression → actual-vs-predicted (equal-length), no confusion matrix.
    avp = diag["actual_vs_predicted"]
    assert len(avp["actual"]) == len(avp["predicted"]) > 0
    assert "confusion" not in diag
    # Permutation importance is non-negative (clamped) and normalized.
    assert diag["permutation_importance"]
    assert all(p["weight"] >= 0 for p in diag["permutation_importance"])
    # Explain stats are capped and every array stays parallel (features ⊆ columns).
    ex = diag["explain"]
    lengths = {len(ex[k]) for k in ("features", "origins", "categories", "means", "stds", "importances")}
    assert len(lengths) == 1  # all parallel
    assert 0 < ex["means"].__len__() <= min(len(fit["feature_columns"]), 40)
    assert set(ex["features"]) <= set(fit["feature_columns"])


def test_fit_classification_path():
    fit = automl_service._fit_sync(_classification_rows(), "churned")
    assert fit["problem_type"] == "classification"
    assert fit["metrics"]["accuracy"] > 0.9
    assert "f1_macro" in fit["metrics"]


def test_fit_classification_diagnostics_confusion_matrix():
    fit = automl_service._fit_sync(_classification_rows(), "churned")
    diag = fit["diagnostics"]
    cm = diag["confusion"]
    assert set(cm["labels"]) == {"yes", "no"}
    # Square matrix over the labels; no actual-vs-predicted for classification.
    assert len(cm["matrix"]) == len(cm["labels"]) == len(cm["matrix"][0])
    assert "actual_vs_predicted" not in diag
    assert diag["cv"]["metric"] == "accuracy"
    lb = fit["leaderboard"]
    assert all("f1_macro" in e for e in lb)


def test_predict_returns_per_prediction_explanation():
    fit = automl_service._fit_sync(_regression_rows(), "revenue")
    explain = fit["diagnostics"]["explain"]
    preds, expl = automl_service._predict_sync(
        fit["blob"], fit["feature_columns"], [{"quantity": 39, "region": "West"}], explain
    )
    assert len(preds) == 1 and len(expl) == 1
    row_expl = expl[0]
    assert row_expl  # at least one influential feature surfaced
    assert all({"feature", "value", "influence"} <= set(e) for e in row_expl)
    assert abs(sum(e["influence"] for e in row_expl) - 1.0) < 0.01  # normalized


def test_predict_explanation_empty_without_stats():
    # No explain stats (legacy model) → empty explanation, predictions still work.
    fit = automl_service._fit_sync(_regression_rows(), "revenue")
    preds, expl = automl_service._predict_sync(
        fit["blob"], fit["feature_columns"], [{"quantity": 5, "region": "North"}], None
    )
    assert len(preds) == 1 and expl == [[]]


def test_explanation_names_original_column_not_dummy():
    # A categorical input must surface as ("region", "West"), never ("region_West", 1.0).
    fit = automl_service._fit_sync(_regression_rows(), "revenue")
    _, expl = automl_service._predict_sync(
        fit["blob"], fit["feature_columns"], [{"quantity": 39, "region": "West"}],
        fit["diagnostics"]["explain"],
    )
    features = {e["feature"] for e in expl[0]}
    assert "region" in features and not any("region_" in f for f in features)
    region = next(e for e in expl[0] if e["feature"] == "region")
    assert region["value"] == "West"


def test_predict_batch_one_bad_cell_does_not_poison_numeric_column():
    # 9/10 numeric-string quantities + 1 junk: the column still coerces (≥90%), so
    # the good rows predict on their real values (varying), not a poisoned all-zero.
    fit = automl_service._fit_sync(_regression_rows(), "revenue")
    rows = [{"quantity": str(q), "region": "North"} for q in range(10, 19)]
    rows.append({"quantity": "junk", "region": "North"})
    preds, _ = automl_service._predict_sync(fit["blob"], fit["feature_columns"], rows)
    assert len(set(round(p, 3) for p in preds[:9])) > 1  # not all identical → not poisoned


def test_confusion_labels_sorted_numerically_for_numeric_classes():
    # Numeric class labels 1,2,10 must order as 1,2,10 — not lexically 1,10,2.
    rows = [{"spend": float(i), "tier": [1, 2, 10][i % 3]} for i in range(90)]
    fit = automl_service._fit_sync(rows, "tier")
    labels = fit["diagnostics"]["confusion"]["labels"]
    assert labels == sorted(labels, key=lambda s: float(s))  # numeric order
    assert labels.index("2") < labels.index("10")


def test_json_safe_strips_non_finite_floats():
    out = automl_service._json_safe({"a": float("nan"), "b": [float("inf"), 1.5], "c": "x"})
    assert out == {"a": None, "b": [None, 1.5], "c": "x"}


def test_fit_rejects_missing_target_and_tiny_data():
    with pytest.raises(NexusBIException, match="tapılmadı"):
        automl_service._fit_sync(_regression_rows(), "yox_belə_sütun")
    with pytest.raises(NexusBIException, match="sətir"):
        automl_service._fit_sync(_regression_rows(10), "revenue")


def test_predict_handles_unseen_category_via_reindex():
    fit = automl_service._fit_sync(_regression_rows(), "revenue")
    preds, _ = automl_service._predict_sync(
        fit["blob"],
        fit["feature_columns"],
        [{"quantity": 10, "region": "Mars"}],  # unseen category → all-zero dummies
    )
    assert len(preds) == 1 and isinstance(preds[0], float)


def test_predict_coerces_numeric_strings_to_the_numeric_column():
    # "10" must hit the numeric quantity column, not become a quantity_10 dummy.
    fit = automl_service._fit_sync(_regression_rows(), "revenue")
    as_str, _ = automl_service._predict_sync(
        fit["blob"], fit["feature_columns"], [{"quantity": "10", "region": "North"}]
    )
    as_num, _ = automl_service._predict_sync(
        fit["blob"], fit["feature_columns"], [{"quantity": 10, "region": "North"}]
    )
    assert as_str == as_num


def test_numeric_low_cardinality_target_keeps_numeric_class_labels():
    # rating 1..5 → classification, but predictions stay numbers (not '1.0' strings)
    rows = [{"spend": float(i), "rating": (i % 5) + 1} for i in range(200)]
    fit = automl_service._fit_sync(rows, "rating")
    assert fit["problem_type"] == "classification"
    preds, _ = automl_service._predict_sync(fit["blob"], fit["feature_columns"], [{"spend": 42.0}])
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
    # Diagnostics + leaderboard survive the round-trip to the client.
    assert model["leaderboard"] and any(e["is_best"] for e in model["leaderboard"])
    assert model["diagnostics"]["cv"]["mean"] is not None

    listed = (await client.get("/api/v1/automl/models", headers=auth)).json()
    assert any(m["id"] == model["id"] for m in listed)

    pred = await client.post(
        f"/api/v1/automl/models/{model['id']}/predict",
        json={"rows": [{"quantity": 5, "region": "North", "category": "Books"}]},
        headers=auth,
    )
    assert pred.status_code == 200, pred.text
    body = pred.json()
    assert len(body["predictions"]) == 1
    assert len(body["explanations"]) == 1  # per-prediction explanation surfaced

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


# ─── Migration ───


def test_automl_diagnostics_migration_up_down():
    """The diagnostics migration adds leaderboard+diagnostics on upgrade and cleanly
    removes them on downgrade, driven directly against a throwaway SQLite DB."""
    import importlib.util
    from pathlib import Path

    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    from sqlalchemy import create_engine, inspect, text

    mig_path = (
        Path(automl_service.__file__).parents[1]
        / "db/migrations/versions/e6f7a8b9c0d1_add_automl_diagnostics.py"
    )
    spec = importlib.util.spec_from_file_location("_mig_automl_diag", mig_path)
    mig = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mig)
    assert mig.down_revision == "d5e6f7a8b9c0"  # chains onto the current head

    engine = create_engine("sqlite://")
    try:
        with engine.connect() as conn:
            # The migration only ADDS columns → start from a minimal ml_models.
            conn.execute(text("CREATE TABLE ml_models (id VARCHAR PRIMARY KEY, name VARCHAR)"))
            ctx = MigrationContext.configure(conn)
            with Operations.context(ctx):
                mig.upgrade()
            cols = {c["name"] for c in inspect(conn).get_columns("ml_models")}
            assert {"leaderboard", "diagnostics"} <= cols
            with Operations.context(ctx):
                mig.downgrade()
            cols2 = {c["name"] for c in inspect(conn).get_columns("ml_models")}
            assert "leaderboard" not in cols2 and "diagnostics" not in cols2
    finally:
        engine.dispose()
