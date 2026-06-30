"""A/B experiment schemas."""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

Kind = Literal["conversion", "mean"]


class ExperimentCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    kind: Kind = "conversion"
    a_label: str = Field(default="A", max_length=80)
    b_label: str = Field(default="B", max_length=80)
    # conversion → {a:{n,conversions}, b:{n,conversions}}; mean → {a:{n,mean,sd}, b:{...}}
    data: dict = Field(default_factory=dict)
    notes: str = Field(default="", max_length=2000)


class ExperimentResponse(BaseModel):
    id: str
    name: str
    kind: str
    a_label: str
    b_label: str
    data: dict
    result: dict | None
    status: str
    notes: str
    created_at: datetime

    model_config = {"from_attributes": True}
