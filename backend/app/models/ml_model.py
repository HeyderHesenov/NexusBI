"""MLModel — a trained AutoML model with its pickled estimator blob.

SECURITY: ``model_blob`` is a pickle of OUR OWN trained estimator. It is only
ever created by ``automl_service.train`` and only ever unpickled after being
read back from this table. No endpoint accepts serialized bytes from a client,
and the blob is excluded from every schema/response.
"""
from __future__ import annotations

import uuid

from sqlalchemy import JSON, ForeignKey, Integer, LargeBinary, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


def _uuid() -> str:
    return str(uuid.uuid4())


class MLModel(Base, TimestampMixin):
    __tablename__ = "ml_models"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    source_table: Mapped[str] = mapped_column(String(255), nullable=False)
    # NULL = demo dataset; otherwise the user's connected source the data came from.
    datasource_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("datasources.id", ondelete="SET NULL"), nullable=True
    )
    target_column: Mapped[str] = mapped_column(String(255), nullable=False)
    # FINAL training columns (post get_dummies) — predict() reindexes onto these.
    feature_columns: Mapped[list] = mapped_column(JSON, nullable=False)
    # "regression" | "classification"
    problem_type: Mapped[str] = mapped_column(String(20), nullable=False)
    best_algo: Mapped[str] = mapped_column(String(50), nullable=False)
    metrics: Mapped[dict] = mapped_column(JSON, nullable=False)
    importances: Mapped[list] = mapped_column(JSON, nullable=False)
    # Candidate scoreboard (every algorithm tried + its score), and richer
    # diagnostics (k-fold CV, confusion matrix / actual-vs-predicted, permutation
    # importance, per-prediction explain stats). Nullable so models trained before
    # this column existed still load. See automl_service._build_diagnostics.
    leaderboard: Mapped[list | None] = mapped_column(JSON, nullable=True)
    diagnostics: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    model_blob: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    sklearn_version: Mapped[str] = mapped_column(String(20), nullable=False)
    row_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
