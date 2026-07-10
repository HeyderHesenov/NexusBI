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
_NUMERIC_COERCE_FRAC = 0.9  # a column is numeric when ≥ this share of cells parse as numbers
RF_TREES = 50
SEED = 42
# Diagnostics knobs.
CV_FOLDS = 5  # k for cross-validation of the winning estimator
_MAX_AVP_POINTS = 200  # actual-vs-predicted points persisted for the scatter
_MAX_CONFUSION_CLASSES = 15  # skip the confusion matrix beyond this many classes
_PERM_REPEATS = 5  # permutation-importance shuffles per feature
_EXPLAIN_TOP = 3  # features surfaced per per-prediction explanation
_EXPLAIN_STATS_MAX = 40  # per-feature stats persisted for explanations (bounds JSON size)


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
        leaderboard=m.leaderboard or [],
        diagnostics=m.diagnostics or {},
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
            if coerced.notna().mean() >= _NUMERIC_COERCE_FRAC:
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

    # Original (pre one-hot) column names — lets explanations name the real column
    # ("region") instead of the encoded dummy ("region_West").
    pre_dummy_cols = [str(c) for c in x_df.columns]
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
        leaderboard = [
            {"algo": a, "metric": "r2", "score": round(s, 4), "is_best": a == best_algo}
            for s, a, _ in scored
        ]
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
        leaderboard = [
            {
                "algo": a, "metric": "accuracy",
                "score": round(sc[0], 4), "f1_macro": round(sc[1], 4),
                "is_best": a == best_algo,
            }
            for sc, a, _ in scored
        ]

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

    diagnostics = _build_diagnostics(
        problem=problem,
        best_model=best_model,
        feature_columns=feature_columns,
        pre_dummy_cols=pre_dummy_cols,
        importance_weights=weights,  # reuse the vector already derived above
        x_full=x_df.values.astype(float),
        y_full=y_values,
        x_test=x_test,
        y_test=y_test,
    )

    blob = pickle.dumps(best_model)
    if len(blob) > MAX_BLOB_BYTES:
        raise NexusBIException("Model həddindən böyükdür.")
    return {
        "problem_type": problem,
        "best_algo": best_algo,
        "metrics": metrics,
        "importances": importances,
        "leaderboard": leaderboard,
        "diagnostics": diagnostics,
        "feature_columns": feature_columns,
        "blob": blob,
        "sklearn_version": sklearn.__version__,
        "row_count": int(len(df)),
    }


def _origin_of(feature: str, pre_dummy_cols: list[str]) -> tuple[str, str | None]:
    """Map a post-one-hot feature back to (original column, category). A plain numeric
    column returns (itself, None); a dummy ``region_West`` returns ("region", "West").
    Picks the LONGEST matching prefix so a column name containing '_' isn't mis-split."""
    if feature in pre_dummy_cols:
        return feature, None
    best: str | None = None
    for c in pre_dummy_cols:
        if feature.startswith(c + "_") and (best is None or len(c) > len(best)):
            best = c
    if best is not None:
        return best, feature[len(best) + 1 :]
    return feature, None


def _label_sort_key(label: str) -> tuple[int, float | str]:
    """Order class labels numerically when they are numbers ('2' before '10'),
    lexically otherwise — a numeric target keeps numeric labels (see _fit_sync)."""
    try:
        return (0, float(label))
    except (TypeError, ValueError):
        return (1, label)


def _json_safe(obj: Any) -> Any:
    """Replace non-finite floats (NaN/±Inf) with None so the diagnostics JSON never
    serializes a bare ``NaN`` token that strict JSON.parse on the client would reject.
    (A near-constant CV fold yields an undefined r2 that never raises.)"""
    import math

    if isinstance(obj, float):
        return obj if math.isfinite(obj) else None
    if isinstance(obj, dict):
        return {k: _json_safe(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_json_safe(v) for v in obj]
    return obj


def _build_diagnostics(
    *,
    problem: str,
    best_model: Any,
    feature_columns: list[str],
    pre_dummy_cols: list[str],
    importance_weights: Any,
    x_full: Any,
    y_full: Any,
    x_test: Any,
    y_test: Any,
) -> dict[str, Any]:
    """Richer, honest diagnostics for the winning model (all computed in-thread):
    k-fold CV of the winner, a confusion matrix (classification) or actual-vs-predicted
    points (regression), permutation importance, and per-feature mean/std used for
    per-prediction explanations. Each piece degrades gracefully to empty on failure —
    diagnostics must never sink a successful training run."""
    import numpy as np
    from sklearn.base import clone
    from sklearn.inspection import permutation_importance
    from sklearn.metrics import confusion_matrix
    from sklearn.model_selection import KFold, StratifiedKFold, cross_val_score

    diag: dict[str, Any] = {}

    # ── k-fold CV of the winning estimator (a single holdout can flatter/​punish) ──
    try:
        if problem == "classification":
            _, class_counts = np.unique(y_full, return_counts=True)
            folds = int(min(CV_FOLDS, class_counts.min()))
            splitter = StratifiedKFold(n_splits=folds, shuffle=True, random_state=SEED)
            metric_name = "accuracy"
        else:
            folds = int(min(CV_FOLDS, len(y_full)))
            # Shuffle: rows arrive in table order (no ORDER BY), so contiguous folds
            # on a target that trends over the rows would each see a narrow range.
            splitter = KFold(n_splits=folds, shuffle=True, random_state=SEED)
            metric_name = "r2"
        if folds >= 2:
            scores = cross_val_score(
                clone(best_model), x_full, y_full, cv=splitter, scoring=metric_name
            )
            # A (near-)constant fold makes r2 undefined → NaN; drop it rather than
            # persist a NaN that would poison the whole diagnostics payload.
            if np.isfinite(scores).all():
                diag["cv"] = {
                    "metric": metric_name,
                    "folds": folds,
                    "scores": [round(float(s), 4) for s in scores],
                    "mean": round(float(scores.mean()), 4),
                    "std": round(float(scores.std()), 4),
                }
    except Exception as exc:  # noqa: BLE001 — diagnostics are best-effort
        _log.warning("automl_cv_failed", error=str(exc)[:200])

    # ── Holdout shape: confusion matrix (clf) or actual-vs-predicted (reg) ──
    try:
        y_pred = best_model.predict(x_test)
        if problem == "classification":
            labels = sorted({str(v) for v in np.concatenate([y_test, y_pred])}, key=_label_sort_key)
            if len(labels) <= _MAX_CONFUSION_CLASSES:
                cm = confusion_matrix(
                    [str(v) for v in y_test], [str(v) for v in y_pred], labels=labels
                )
                diag["confusion"] = {"labels": labels, "matrix": cm.astype(int).tolist()}
        else:
            actual = [float(v) for v in y_test]
            predicted = [float(v) for v in y_pred]
            if len(actual) > _MAX_AVP_POINTS:  # even stride keeps the range representative
                step = len(actual) / _MAX_AVP_POINTS
                idx = [int(i * step) for i in range(_MAX_AVP_POINTS)]
                actual = [round(actual[i], 4) for i in idx]
                predicted = [round(predicted[i], 4) for i in idx]
            else:
                actual = [round(v, 4) for v in actual]
                predicted = [round(v, 4) for v in predicted]
            diag["actual_vs_predicted"] = {"actual": actual, "predicted": predicted}
    except Exception as exc:  # noqa: BLE001
        _log.warning("automl_holdout_shape_failed", error=str(exc)[:200])

    # ── Permutation importance (model-agnostic; complements the built-in weights) ──
    try:
        perm = permutation_importance(
            best_model, x_test, y_test, n_repeats=_PERM_REPEATS, random_state=SEED
        )
        # Clamp negatives: a feature whose shuffle IMPROVES the score contributes
        # nothing, so show it as 0 rather than a nonsense negative bar downstream.
        pm = np.clip(perm.importances_mean, 0.0, None)
        total = float(pm.sum()) or 1.0
        diag["permutation_importance"] = sorted(
            (
                {"feature": f, "weight": round(float(w) / total, 4)}
                for f, w in zip(feature_columns, pm)
            ),
            key=lambda d: d["weight"],
            reverse=True,
        )[:15]
    except Exception as exc:  # noqa: BLE001
        _log.warning("automl_perm_importance_failed", error=str(exc)[:200])

    # ── Per-feature stats (mean/std + reused importance) for per-prediction explains.
    # Capped to the most important features so a wide one-hot expansion can't bloat
    # the persisted JSON; each carries its original column + category for display. ──
    try:
        means = x_full.mean(axis=0)
        stds = x_full.std(axis=0)
        imp = np.asarray(importance_weights, dtype=float)  # reuse _fit_sync's vector
        imp_total = float(imp.sum()) or 1.0
        order = [int(i) for i in np.argsort(imp)[::-1][:_EXPLAIN_STATS_MAX]]
        explain: dict[str, list[Any]] = {
            "features": [], "origins": [], "categories": [],
            "means": [], "stds": [], "importances": [],
        }
        for i in order:
            origin, category = _origin_of(feature_columns[i], pre_dummy_cols)
            explain["features"].append(feature_columns[i])
            explain["origins"].append(origin)
            explain["categories"].append(category)
            explain["means"].append(round(float(means[i]), 4))
            explain["stds"].append(round(float(stds[i]), 4))
            explain["importances"].append(round(float(imp[i]) / imp_total, 4))
        diag["explain"] = explain
    except Exception as exc:  # noqa: BLE001
        _log.warning("automl_explain_stats_failed", error=str(exc)[:200])

    return _json_safe(diag)


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
        leaderboard=fit["leaderboard"],
        diagnostics=fit["diagnostics"],
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


def _explain_rows(
    matrix: Any, feature_columns: list[str], explain: dict[str, Any] | None
) -> list[list[dict[str, Any]]]:
    """For each input row, the few features that most influenced its prediction:
    (model importance) × (how many std-devs the input value sits from the training
    mean). Honest local attribution — "important AND unusual for this input" — not a
    causal claim. Names the ORIGINAL column ("region", value "West"), not the encoded
    dummy, and keeps only the strongest dummy per column. Empty per row when explain
    stats are unavailable (e.g. a model trained before diagnostics existed)."""
    explain = explain or {}
    feats = explain.get("features") or []
    origins = explain.get("origins") or []
    cats = explain.get("categories") or []
    means = explain.get("means") or []
    stds = explain.get("stds") or []
    imps = explain.get("importances") or []
    n = min(len(feats), len(origins), len(cats), len(means), len(stds), len(imps))
    if n == 0:
        return [[] for _ in matrix]
    col_index = {f: i for i, f in enumerate(feature_columns)}
    out: list[list[dict[str, Any]]] = []
    for row in matrix:
        # Best (highest-scoring) feature per original column → value shown.
        best_by_origin: dict[str, tuple[float, Any]] = {}
        for k in range(n):
            ci = col_index.get(feats[k])
            if ci is None or ci >= len(row):
                continue
            val = float(row[ci])
            is_dummy = cats[k] is not None
            if is_dummy and val < 0.5:
                continue  # this category isn't the row's — don't attribute it here
            std = stds[k]
            z = (val - means[k]) / std if std else 0.0
            score = imps[k] * abs(z)
            if score <= 0:
                continue
            display = cats[k] if is_dummy else round(val, 4)
            prev = best_by_origin.get(origins[k])
            if prev is None or score > prev[0]:
                best_by_origin[origins[k]] = (score, display)
        ranked = sorted(best_by_origin.items(), key=lambda kv: kv[1][0], reverse=True)[:_EXPLAIN_TOP]
        total = sum(score for _, (score, _) in ranked) or 1.0
        out.append(
            [
                {"feature": origin, "value": display, "influence": round(score / total, 4)}
                for origin, (score, display) in ranked
            ]
        )
    return out


def _predict_sync(
    blob: bytes,
    feature_columns: list[str],
    rows: list[dict[str, Any]],
    explain: dict[str, Any] | None = None,
) -> tuple[list[Any], list[list[dict[str, Any]]]]:
    import pandas as pd

    # Only our own blob (see module docstring) — never client-supplied bytes.
    model = pickle.loads(blob)  # noqa: S301
    df = pd.DataFrame(rows)
    # A numeric sent as "5" must hit the numeric training column, not become a
    # spurious one-hot ("quantity_5") that reindex would silently zero out. Use the
    # SAME ≥90% threshold as training (not "all"), so one junk cell in a batch of
    # rows doesn't demote the whole numeric column into dummies for every row.
    for col in df.columns:
        if df[col].dtype == object:
            coerced = pd.to_numeric(df[col], errors="coerce")
            if coerced.notna().mean() >= _NUMERIC_COERCE_FRAC:
                df[col] = coerced
    df = pd.get_dummies(df, dummy_na=False)
    # Unseen categories become all-zero dummies; missing numerics fill with 0.
    df = df.reindex(columns=feature_columns, fill_value=0).fillna(0)
    matrix = df.values.astype(float)
    preds = model.predict(matrix)
    predictions = [p.item() if hasattr(p, "item") else p for p in preds]
    return predictions, _explain_rows(matrix, feature_columns, explain)


async def predict(
    db: AsyncSession, user_id: str, model_id: str, rows: list[dict[str, Any]]
) -> tuple[list[Any], list[list[dict[str, Any]]]]:
    """Returns (predictions, per-prediction explanations) parallel to ``rows``."""
    if not rows:
        return [], []
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
    explain = (m.diagnostics or {}).get("explain")
    return await asyncio.to_thread(
        _predict_sync, m.model_blob, m.feature_columns or [], rows, explain
    )


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
