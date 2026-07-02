"""AutoML: train a small tabular model on a table, persist it, predict.

Design constraints:
- sklearn/pandas imports live INSIDE functions — no startup/test import cost.
- All CPU-bound work (seeding, prep, fit) runs via ``asyncio.to_thread``.
- Table names are allowlisted (demo tables or the user's own datasource).
- SECURITY: the pickle blob is only our own estimator, written by ``train`` and
  read back from our DB; no endpoint accepts serialized bytes from a client.
"""
from __future__ import annotations

import asyncio
import pickle
import re
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NexusBIException, SchemaNotFoundError
from app.core.logging import get_logger
from app.db.demo_data import demo_table_names, execute_demo_snapshot
from app.models.ml_model import MLModel
from app.schemas.automl import MLModelOut
from app.services import datasource_service

_log = get_logger("nexusbi.automl")

MAX_TRAIN_ROWS = 5000
MAX_PREDICT_ROWS = 100
MAX_BLOB_BYTES = 5 * 1024 * 1024
_MAX_DUMMY_CARDINALITY = 30  # categorical cols with more uniques are dropped
_MIN_ROWS = 30
_TABLE_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,254}$")
RF_TREES = 50
SEED = 42


def to_response(m: MLModel) -> MLModelOut:
    return MLModelOut(
        id=m.id,
        name=m.name,
        source_table=m.source_table,
        datasource_id=m.datasource_id,
        target_column=m.target_column,
        feature_columns=m.feature_columns or [],
        problem_type=m.problem_type,
        best_algo=m.best_algo,
        metrics=m.metrics or {},
        importances=m.importances or [],
        sklearn_version=m.sklearn_version,
        row_count=m.row_count,
        created_at=m.created_at,
    )


async def _load_rows(
    db: AsyncSession,
    cache: Any,
    user_id: str,
    source_table: str,
    datasource_id: str | None,
) -> list[dict[str, Any]]:
    if not _TABLE_RE.match(source_table or ""):
        raise NexusBIException("Yanlış cədvəl adı.")
    sql = f'SELECT * FROM "{source_table}" LIMIT {MAX_TRAIN_ROWS}'
    if datasource_id is None:
        if source_table not in demo_table_names():
            raise NexusBIException("Cədvəl demo modelində yoxdur.")
        rows = (await asyncio.to_thread(execute_demo_snapshot, [sql]))[0]
        return rows or []
    # Live sources go through the SAME guard chain as /query (table allowlist +
    # per-viewer RLS, fail-closed) — training on raw unconstrained rows would
    # leak forbidden rows into metrics/importances/predictions.
    from app.services import query_service

    ds = await datasource_service.get_datasource(db, user_id, datasource_id)
    schema = await datasource_service.get_schema_cached(ds, cache)
    _, rows = await query_service._guarded_execute(ds, sql, schema, db, user_id)
    return rows


def _fit_sync(
    rows: list[dict[str, Any]], target_column: str
) -> dict[str, Any]:
    """Blocking prep + model selection. Runs in a worker thread."""
    import numpy as np
    import pandas as pd
    import sklearn
    from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
    from sklearn.linear_model import LinearRegression, LogisticRegression
    from sklearn.metrics import accuracy_score, f1_score, r2_score
    from sklearn.model_selection import train_test_split

    df = pd.DataFrame(rows)
    if target_column not in df.columns:
        raise NexusBIException("Hədəf sütunu cədvəldə tapılmadı.")
    df = df.dropna(subset=[target_column])
    if len(df) < _MIN_ROWS:
        raise NexusBIException(f"Öyrətmə üçün ən azı {_MIN_ROWS} sətir lazımdır.")

    y_raw = df[target_column]
    x_df = df.drop(columns=[target_column])

    # Recover numerics that arrived as object dtype (string-typed drivers, or a
    # numeric column with NULLs) — otherwise a predictive high-cardinality
    # numeric would be dropped below as if it were categorical.
    for col in list(x_df.columns):
        s = x_df[col]
        if s.dtype == object:
            coerced = pd.to_numeric(s, errors="coerce")
            if coerced.notna().mean() >= 0.9:
                x_df[col] = coerced

    # Drop identifier-ish and unusable columns.
    for col in list(x_df.columns):
        s = x_df[col]
        if col.lower() == "id" or col.lower().endswith("_id"):
            x_df = x_df.drop(columns=[col])
        elif s.dtype == object and s.nunique() > _MAX_DUMMY_CARDINALITY:
            x_df = x_df.drop(columns=[col])
    if x_df.empty or not len(x_df.columns):
        raise NexusBIException("Uyğun feature sütunu qalmadı.")

    x_df = pd.get_dummies(x_df, dummy_na=False)
    x_df = x_df.fillna(0)
    feature_columns = [str(c) for c in x_df.columns]

    target_is_numeric = pd.api.types.is_numeric_dtype(y_raw)
    problem = "regression" if target_is_numeric and y_raw.nunique() > 10 else "classification"

    # Numeric class labels stay numeric (sklearn accepts them; '1.0' strings
    # would leak into predictions); only non-numeric targets are stringified.
    y_values = y_raw.values if target_is_numeric else y_raw.astype(str).values
    stratify = None
    if problem == "classification":
        counts = pd.Series(y_values).value_counts()
        if len(counts) < 2:
            raise NexusBIException("Hədəf sütununda ən azı 2 sinif olmalıdır.")
        # Stratify keeps rare classes in BOTH splits (needs ≥2 members each).
        if counts.min() >= 2:
            stratify = y_values

    x_train, x_test, y_train, y_test = train_test_split(
        x_df.values.astype(float), y_values, test_size=0.2, random_state=SEED, stratify=stratify
    )

    if problem == "regression":
        candidates = [
            ("linear_regression", LinearRegression()),
            ("random_forest", RandomForestRegressor(n_estimators=RF_TREES, random_state=SEED)),
        ]
        y_train_f = y_train.astype(float)
        y_test_f = y_test.astype(float)
        scored = []
        for algo, model in candidates:
            model.fit(x_train, y_train_f)
            scored.append((float(r2_score(y_test_f, model.predict(x_test))), algo, model))
        scored.sort(key=lambda s: s[0], reverse=True)
        best_score, best_algo, best_model = scored[0]
        metrics = {"r2": round(best_score, 4)}
    else:
        if len(set(y_train)) < 2:
            raise NexusBIException("Hədəf sütununda ən azı 2 sinif olmalıdır.")
        candidates = [
            ("logistic_regression", LogisticRegression(max_iter=1000)),
            ("random_forest", RandomForestClassifier(n_estimators=RF_TREES, random_state=SEED)),
        ]
        scored = []
        for algo, model in candidates:
            model.fit(x_train, y_train)
            pred = model.predict(x_test)
            acc = float(accuracy_score(y_test, pred))
            f1 = float(f1_score(y_test, pred, average="macro"))
            scored.append(((acc, f1), algo, model))
        scored.sort(key=lambda s: s[0], reverse=True)
        (acc, f1), best_algo, best_model = scored[0]
        metrics = {"accuracy": round(acc, 4), "f1_macro": round(f1, 4)}

    if hasattr(best_model, "feature_importances_"):
        weights = best_model.feature_importances_
    else:
        coef = np.atleast_2d(best_model.coef_)
        weights = np.abs(coef).mean(axis=0)
    total = float(weights.sum()) or 1.0
    importances = sorted(
        (
            {"feature": f, "weight": round(float(w) / total, 4)}
            for f, w in zip(feature_columns, weights)
        ),
        key=lambda d: d["weight"],
        reverse=True,
    )[:15]

    blob = pickle.dumps(best_model)
    if len(blob) > MAX_BLOB_BYTES:
        raise NexusBIException("Model həddindən böyükdür.")
    return {
        "problem_type": problem,
        "best_algo": best_algo,
        "metrics": metrics,
        "importances": importances,
        "feature_columns": feature_columns,
        "blob": blob,
        "sklearn_version": sklearn.__version__,
        "row_count": int(len(df)),
    }


async def train(
    db: AsyncSession,
    cache: Any,
    user_id: str,
    name: str,
    source_table: str,
    datasource_id: str | None,
    target_column: str,
) -> MLModel:
    rows = await _load_rows(db, cache, user_id, source_table, datasource_id)
    if not rows:
        raise NexusBIException("Cədvəldən sətir oxunmadı.")
    fit = await asyncio.to_thread(_fit_sync, rows, target_column)
    model = MLModel(
        user_id=user_id,
        name=(name or "").strip() or f"{source_table}.{target_column}",
        source_table=source_table,
        datasource_id=datasource_id,
        target_column=target_column,
        feature_columns=fit["feature_columns"],
        problem_type=fit["problem_type"],
        best_algo=fit["best_algo"],
        metrics=fit["metrics"],
        importances=fit["importances"],
        model_blob=fit["blob"],
        sklearn_version=fit["sklearn_version"],
        row_count=fit["row_count"],
    )
    db.add(model)
    await db.flush()
    await db.refresh(model)
    _log.info(
        "automl_trained",
        table=source_table,
        problem=fit["problem_type"],
        algo=fit["best_algo"],
        rows=fit["row_count"],
    )
    return model


def _predict_sync(
    blob: bytes, feature_columns: list[str], rows: list[dict[str, Any]]
) -> list[Any]:
    import pandas as pd

    # Only our own blob (see module docstring) — never client-supplied bytes.
    model = pickle.loads(blob)  # noqa: S301
    df = pd.DataFrame(rows)
    # A numeric sent as "5" must hit the numeric training column, not become a
    # spurious one-hot ("quantity_5") that reindex would silently zero out.
    for col in df.columns:
        if df[col].dtype == object:
            coerced = pd.to_numeric(df[col], errors="coerce")
            if coerced.notna().all():
                df[col] = coerced
    df = pd.get_dummies(df, dummy_na=False)
    # Unseen categories become all-zero dummies; missing numerics fill with 0.
    df = df.reindex(columns=feature_columns, fill_value=0).fillna(0)
    preds = model.predict(df.values.astype(float))
    return [p.item() if hasattr(p, "item") else p for p in preds]


async def predict(
    db: AsyncSession, user_id: str, model_id: str, rows: list[dict[str, Any]]
) -> list[Any]:
    if not rows:
        return []
    if len(rows) > MAX_PREDICT_ROWS:
        raise NexusBIException(f"Bir dəfəyə ən çox {MAX_PREDICT_ROWS} sətir proqnozlana bilər.")
    if any(not r for r in rows):
        # An all-empty row would predict on an all-zero vector — authoritative-
        # looking garbage. Reject instead.
        raise NexusBIException("Proqnoz üçün ən azı bir sahə doldurulmalıdır.")
    m = await get(db, user_id, model_id)
    if m.sklearn_version.split(".")[:2] != _current_sklearn_version().split(".")[:2]:
        raise NexusBIException(
            "Model fərqli scikit-learn versiyası ilə öyrədilib — yenidən öyrədin."
        )
    return await asyncio.to_thread(_predict_sync, m.model_blob, m.feature_columns or [], rows)


def _current_sklearn_version() -> str:
    import sklearn

    return sklearn.__version__


async def list_for_user(db: AsyncSession, user_id: str) -> list[MLModel]:
    res = await db.execute(
        select(MLModel).where(MLModel.user_id == user_id).order_by(MLModel.created_at.desc())
    )
    return list(res.scalars().all())


async def get(db: AsyncSession, user_id: str, model_id: str) -> MLModel:
    res = await db.execute(
        select(MLModel).where(MLModel.id == model_id, MLModel.user_id == user_id)
    )
    m = res.scalar_one_or_none()
    if m is None:
        raise SchemaNotFoundError("Model tapılmadı.")
    return m


async def delete(db: AsyncSession, user_id: str, model_id: str) -> None:
    m = await get(db, user_id, model_id)
    await db.delete(m)
    await db.flush()
