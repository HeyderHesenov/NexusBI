"""Golden set for Text2SQL evaluation over the demo schema.

Each case pairs a natural-language question with a canonical SQL whose RESULT is
the ground truth. The runner scores by **value-based** execution match (do the
result VALUES agree?), so an equivalent query with different column aliases still
passes — only a genuinely different answer counts as a miss.

Demo schema:
  sales(id, product_name, category, revenue, quantity, sale_date, region)
  customers(id, name, email, country, signup_date, total_spent)
  products(id, name, category, price, stock_quantity)
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class GoldenCase:
    nl_query: str
    expected_sql: str


GOLDEN_SET: list[GoldenCase] = [
    # ── Totals / scalars ──
    GoldenCase("ümumi gəlir", "SELECT SUM(revenue) AS total_revenue FROM sales"),
    GoldenCase("neçə müştəri var", "SELECT COUNT(*) AS count FROM customers"),
    GoldenCase("neçə məhsul var", "SELECT COUNT(*) AS count FROM products"),
    GoldenCase("ümumi satılan miqdar", "SELECT SUM(quantity) AS total_quantity FROM sales"),
    GoldenCase("orta məhsul qiyməti", "SELECT AVG(price) AS avg_price FROM products"),
    GoldenCase("orta müştəri xərci", "SELECT AVG(total_spent) AS avg_spent FROM customers"),
    GoldenCase("ən yüksək tək satış gəliri", "SELECT MAX(revenue) AS max_revenue FROM sales"),
    GoldenCase("ən aşağı məhsul qiyməti", "SELECT MIN(price) AS min_price FROM products"),
    # ── Group-by ──
    GoldenCase(
        "kateqoriya üzrə gəlir",
        "SELECT category, SUM(revenue) AS total_revenue FROM sales GROUP BY category",
    ),
    GoldenCase(
        "region üzrə gəlir",
        "SELECT region, SUM(revenue) AS total_revenue FROM sales GROUP BY region",
    ),
    GoldenCase(
        "region üzrə satış sayı",
        "SELECT region, COUNT(*) AS sales_count FROM sales GROUP BY region",
    ),
    GoldenCase(
        "ölkə üzrə müştəri sayı",
        "SELECT country, COUNT(*) AS customer_count FROM customers GROUP BY country",
    ),
    GoldenCase(
        "aylıq gəlir",
        "SELECT substr(sale_date, 1, 7) AS month, SUM(revenue) AS total_revenue "
        "FROM sales GROUP BY substr(sale_date, 1, 7)",
    ),
    GoldenCase(
        "kateqoriya üzrə orta qiymət",
        "SELECT category, AVG(price) AS avg_price FROM products GROUP BY category",
    ),
    # ── Filters ──
    GoldenCase(
        "Electronics kateqoriyasında ümumi gəlir",
        "SELECT SUM(revenue) AS total_revenue FROM sales WHERE category = 'Electronics'",
    ),
    GoldenCase(
        "North regionunda ümumi gəlir",
        "SELECT SUM(revenue) AS total_revenue FROM sales WHERE region = 'North'",
    ),
    # ── Top-N (desc + asc) ──
    GoldenCase(
        "ən çox xərcləyən 5 müştəri",
        "SELECT name, total_spent FROM customers ORDER BY total_spent DESC LIMIT 5",
    ),
    GoldenCase(
        "ən az xərcləyən 5 müştəri",
        "SELECT name, total_spent FROM customers ORDER BY total_spent ASC LIMIT 5",
    ),
    GoldenCase(
        "ən bahalı 10 məhsul",
        "SELECT name, price FROM products ORDER BY price DESC LIMIT 10",
    ),
    GoldenCase(
        "ən çox stok olan 5 məhsul",
        "SELECT name, stock_quantity FROM products ORDER BY stock_quantity DESC LIMIT 5",
    ),
    # ── Distinct ──
    GoldenCase("məhsul kateqoriyaları", "SELECT DISTINCT category FROM products"),
    GoldenCase("müştəri ölkələri", "SELECT DISTINCT country FROM customers"),
]
