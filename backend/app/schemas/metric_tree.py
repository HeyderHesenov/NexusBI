"""Metric tree (KPI decomposition) schemas."""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator

Operator = Literal["add", "sub", "mul", "div"]
SourceKind = Literal["manual", "query"]
Aggregation = Literal["sum", "avg", "min", "max", "last", "count"]
Provenance = Literal["measured", "manual", "unknown"]


class _Binding(BaseModel):
    """The three fields that make a leaf measurable, validated as a unit.

    A half-filled binding (a saved query with no column, say) is not a smaller
    problem than no binding — it resolves to `unknown` either way, but only the
    caller can tell it was a mistake. So it is rejected at the edge instead of
    surfacing later as a leaf that mysteriously has no value.
    """

    source_kind: SourceKind | None = None
    saved_query_id: str | None = None
    value_column: str | None = Field(default=None, max_length=255)
    agg: Aggregation | None = None

    @model_validator(mode="after")
    def _binding_is_complete(self):
        if self.source_kind is None:
            # A PATCH carrying binding fields but no source_kind cannot be
            # applied: the service sets the three as a unit, keyed on
            # source_kind, so accepting this would return 200 having changed
            # nothing — the silent-drop failure that PATCH /alerts already had.
            stray = [
                name for name in ("saved_query_id", "value_column", "agg")
                if getattr(self, name) is not None
            ]
            if stray:
                raise ValueError(
                    "Bağlama sahələri source_kind olmadan dəyişdirilə bilməz: "
                    + ", ".join(stray)
                )
            return self
        if self.source_kind == "query":
            missing = [
                name for name in ("saved_query_id", "value_column", "agg")
                if not getattr(self, name)
            ]
            if missing:
                raise ValueError(
                    "Sorğuya bağlı leaf üçün bunlar tələb olunur: " + ", ".join(missing)
                )
        elif self.source_kind == "manual":
            # Clear rather than reject: switching a leaf back to manual is a
            # normal edit, and storing a binding nothing reads would leave the
            # row claiming a source it does not have.
            self.saved_query_id = None
            self.value_column = None
            self.agg = None
        return self


class MetricNodeCreate(_Binding):
    name: str = Field(min_length=1, max_length=255)
    parent_id: str | None = None
    operator: Operator = "add"
    manual_value: float | None = None
    position: int = 0
    source_kind: SourceKind = "manual"


class MetricNodeUpdate(_Binding):
    # min_length matches MetricNodeCreate. Without it PATCH accepted "" where
    # POST rejects it, and an empty name is not cosmetic: simulate() matches
    # levers BY NAME and summarize() reports names, so a blank one produces a
    # copilot warning that names nothing.
    name: str | None = Field(default=None, min_length=1, max_length=255)
    operator: Operator | None = None
    manual_value: float | None = None
    position: int | None = None


class MetricNodeResponse(BaseModel):
    id: str
    parent_id: str | None
    name: str
    operator: str
    manual_value: float | None
    position: int
    source_kind: str
    saved_query_id: str | None
    value_column: str | None
    agg: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class BindableSource(BaseModel):
    """A saved query a leaf can measure from, and the columns it can measure."""

    saved_query_id: str
    name: str
    columns: list[str]
    last_run_at: datetime | None


class EvaluatedNode(BaseModel):
    id: str
    name: str
    operator: str
    # None means "unknown", NOT zero: some leaf under this node has no value, so
    # there is no honest number to report here. Clients render it as "—" and the
    # what-if tools refuse to run on it.
    value: float | None = None
    # The stored hand-typed value, kept for the edit form. It survives a switch
    # to source_kind='query' (so switching back restores it) and is therefore
    # NOT the leaf's value — read `value` with `provenance` for that.
    manual_value: float | None = None
    source_kind: str = "manual"
    saved_query_id: str | None = None
    value_column: str | None = None
    agg: str | None = None
    # Leaves only; an internal node inherits its trustworthiness from below and
    # reports it through `incomplete`.
    provenance: Provenance | None = None
    source: str | None = None       # human-readable "<query> / <column> (<agg>)"
    measured_at: datetime | None = None
    unknown_reason: str | None = None
    incomplete: bool = False
    contribution_pct: float | None = None
    children: list["EvaluatedNode"] = Field(default_factory=list)
