"""Causal / driver analysis schemas."""
from __future__ import annotations

from pydantic import BaseModel, Field


class CausalDriver(BaseModel):
    feature: str
    r: float
    p_value: float
    significant: bool
    direction: str  # "müsbət" | "mənfi"
    strength: str  # "zəif" | "orta" | "güclü"


class CausalResponse(BaseModel):
    target: str = ""
    drivers: list[CausalDriver] = Field(default_factory=list)
    summary: str = ""
    caveats: list[str] = Field(default_factory=list)
