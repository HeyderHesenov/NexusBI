"""Golden set for Text2SQL evaluation over the demo schema.

Each case pairs a natural-language question with a canonical SQL whose RESULT is
the ground truth. The runner scores by execution-match (does the engine's SQL
return the same rows?), not string equality — so equivalent SQL still passes.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class GoldenCase:
    nl_query: str
    expected_sql: str


GOLDEN_SET: list[GoldenCase] = [
    GoldenCase("ümumi gəlir", "SELECT SUM(revenue) AS total_revenue FROM sales"),
    GoldenCase(
        "kateqoriya üzrə gəlir",
        "SELECT category, SUM(revenue) AS total_revenue FROM sales "
        "GROUP BY category ORDER BY total_revenue DESC LIMIT 20",
    ),
    GoldenCase("neçə müştəri var", "SELECT COUNT(*) AS count FROM customers"),
    GoldenCase(
        "ən çox xərcləyən 5 müştəri",
        "SELECT name, total_spent FROM customers ORDER BY total_spent DESC LIMIT 5",
    ),
    GoldenCase(
        "region üzrə satış",
        "SELECT region, SUM(revenue) AS total_revenue FROM sales "
        "GROUP BY region ORDER BY total_revenue DESC LIMIT 20",
    ),
]
