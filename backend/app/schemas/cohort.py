"""Cohort retention and funnel schemas."""
from __future__ import annotations

from pydantic import BaseModel


class CohortQuery(BaseModel):
    """Column mapping for real-data cohort analysis. All-optional: an empty
    body (or any missing field) falls back to the deterministic demo snapshot."""

    datasource_id: str | None = None
    table: str | None = None
    entity_col: str | None = None
    date_col: str | None = None  # retention: the event timestamp column
    stage_col: str | None = None  # funnel: the stage/event-type column


class CohortCell(BaseModel):
    count: int
    pct: float


class CohortResponse(BaseModel):
    cohorts: list[str]  # cohort month labels, e.g. "2024-03"
    offsets: list[int]  # month offsets 0..N
    sizes: list[int]  # cohort sizes, parallel to `cohorts`
    cells: list[list[CohortCell | None]]  # None = beyond the data range


class FunnelStep(BaseModel):
    name: str
    count: int
    pct_of_first: float
    drop_pct: float


class FunnelResponse(BaseModel):
    steps: list[FunnelStep]
