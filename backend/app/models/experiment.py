"""A/B experiment — two variants, statistical significance verdict."""
from __future__ import annotations

import uuid

from sqlalchemy import JSON, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


def _uuid() -> str:
    return str(uuid.uuid4())


class Experiment(Base, TimestampMixin):
    __tablename__ = "experiments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False, default="conversion")  # conversion | mean
    a_label: Mapped[str] = mapped_column(String(80), nullable=False, default="A")
    b_label: Mapped[str] = mapped_column(String(80), nullable=False, default="B")
    # Inputs per variant: conversion → {n, conversions}; mean → {n, mean, sd}.
    data: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    result: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="draft")  # draft | analyzed
    notes: Mapped[str] = mapped_column(Text, nullable=False, default="")
