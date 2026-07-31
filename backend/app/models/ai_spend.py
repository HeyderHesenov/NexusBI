"""Daily AI spend, aggregated per feature and model.

One row per (day, feature, model) rather than one per call: the operator's
questions are "what did today cost" and "which feature is eating it", and both
are answered by a table that stays a few dozen rows a day and needs no retention
policy. Per-user attribution is deliberately absent — that arrives with billing
in Faza 3, on top of this rather than instead of it.
"""
from __future__ import annotations

from datetime import date

from sqlalchemy import BigInteger, Date, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class AISpendDaily(Base):
    __tablename__ = "ai_spend_daily"

    day: Mapped[date] = mapped_column(Date, primary_key=True)
    feature: Mapped[str] = mapped_column(String(40), primary_key=True)
    model: Mapped[str] = mapped_column(String(80), primary_key=True)
    calls: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    prompt_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    completion_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # BigInteger: a $2100 day overflows a 32-bit micro-USD column.
    micro_usd: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
