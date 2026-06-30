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
    # Additional accepted gold SQLs for questions with more than one CORRECT shape
    # (e.g. the model may or may not include an `id` column). A case passes if the
    # candidate value-matches ANY gold — standard multi-reference Text2SQL scoring.
    alt_sqls: tuple[str, ...] = ()
    # Difficulty: "easy" = single-table aggregation, "medium" = join/HAVING/date,
    # "hard" = subquery/ranking/percentage. Reported per-tier so a 100% on easy +
    # lower on hard tells the truth instead of one saturated number.
    tier: str = "easy"

    @property
    def expected_sqls(self) -> tuple[str, ...]:
        return (self.expected_sql, *self.alt_sqls)


GOLDEN_SET: list[GoldenCase] = [
    # ── Totals / scalars ──
    GoldenCase("ümumi gəlir", "SELECT SUM(revenue) AS total_revenue FROM sales"),
    GoldenCase("neçə müştəri var", "SELECT COUNT(*) AS count FROM customers"),
    GoldenCase("neçə məhsul var", "SELECT COUNT(*) AS count FROM products"),
    GoldenCase("ümumi satılan miqdar", "SELECT SUM(quantity) AS total_quantity FROM sales"),
    GoldenCase("orta məhsul qiyməti", "SELECT AVG(price) AS avg_price FROM products"),
    GoldenCase("orta müştəri xərci", "SELECT AVG(total_spent) AS avg_spent FROM customers"),
    GoldenCase(
        "ən yüksək tək satış gəlirinin məbləği",
        "SELECT MAX(revenue) AS max_revenue FROM sales",
        alt_sqls=("SELECT revenue FROM sales ORDER BY revenue DESC LIMIT 1",),
    ),
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
    # Disambiguated NL ("adı və ümumi xərci") + the system-prompt rule "return only
    # asked columns" steer the model to exactly name+total_spent — so a single gold
    # suffices and we keep _denotation's one-text+one-number invariant intact (no
    # id-variant, which would put two numerics in a row).
    GoldenCase(
        "ən çox xərcləyən 5 müştərinin adı və ümumi xərci",
        "SELECT name, total_spent FROM customers ORDER BY total_spent DESC LIMIT 5",
    ),
    GoldenCase(
        "ən az xərcləyən 5 müştərinin adı və ümumi xərci",
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

    # ══ MEDIUM ══ joins · HAVING · date · paraphrase
    GoldenCase(
        "hər məhsulun adı və ümumi satış gəliri",
        "SELECT p.name, SUM(s.revenue) AS total_revenue FROM products p "
        "JOIN sales s ON s.product_name = p.name GROUP BY p.name",
        # The join is equivalent to grouping sales by product_name — both correct.
        alt_sqls=(
            "SELECT product_name, SUM(revenue) AS total_revenue FROM sales GROUP BY product_name",
        ),
        tier="medium",
    ),
    GoldenCase(
        # Join + filter on a column that lives ONLY on products (price), reduced to a
        # single numeric — keeps _denotation's one-number invariant intact.
        "qiyməti 50-dən baha olan məhsulların ümumi satış gəliri",
        "SELECT SUM(s.revenue) AS total_revenue FROM sales s "
        "JOIN products p ON s.product_name = p.name WHERE p.price > 50",
        tier="medium",
    ),
    GoldenCase(
        "ümumi gəliri 12000-dən çox olan kateqoriyalar",  # → {Books, Sports}
        "SELECT category FROM sales GROUP BY category HAVING SUM(revenue) > 12000",
        tier="medium",
    ),
    GoldenCase(
        "ümumi gəliri 10000-dən çox olan regionlar",  # → {Central, West, East}
        "SELECT region FROM sales GROUP BY region HAVING SUM(revenue) > 10000",
        tier="medium",
    ),
    GoldenCase(
        "2024-cü ilin birinci rübünün ümumi gəliri",
        "SELECT SUM(revenue) AS total_revenue FROM sales "
        "WHERE substr(sale_date, 6, 2) IN ('01', '02', '03')",
        tier="medium",
    ),
    GoldenCase(
        "regionlar üzrə gəliri göstər",  # paraphrase of an easy case — robustness
        "SELECT region, SUM(revenue) AS total_revenue FROM sales GROUP BY region",
        tier="medium",
    ),

    # ══ HARD ══ subquery · ranking · percentage
    GoldenCase(
        "orta qiymətdən baha olan məhsulların adları",
        "SELECT name FROM products WHERE price > (SELECT AVG(price) FROM products)",
        tier="hard",
    ),
    GoldenCase(
        "ikinci ən bahalı məhsulun qiyməti",
        "SELECT DISTINCT price FROM products ORDER BY price DESC LIMIT 1 OFFSET 1",
        tier="hard",
    ),
    GoldenCase(
        "gəlirə görə ikinci ən yüksək region",
        "SELECT region FROM sales GROUP BY region ORDER BY SUM(revenue) DESC LIMIT 1 OFFSET 1",
        tier="hard",
    ),
    GoldenCase(
        "ən çox ümumi gəlir gətirən kateqoriyadakı məhsulların adları",
        "SELECT name FROM products WHERE category = ("
        "SELECT category FROM sales GROUP BY category ORDER BY SUM(revenue) DESC LIMIT 1)",
        tier="hard",
    ),
    GoldenCase(
        "hər regionun ümumi gəlirdəki faiz payı (2 onluq dəqiqliklə)",
        "SELECT region, ROUND(SUM(revenue) * 100.0 / (SELECT SUM(revenue) FROM sales), 2) AS pct "
        "FROM sales GROUP BY region",
        tier="hard",
    ),
    GoldenCase(
        "orta müştəri xərcindən çox xərcləyən müştərilərin sayı",
        "SELECT COUNT(*) AS count FROM customers "
        "WHERE total_spent > (SELECT AVG(total_spent) FROM customers)",
        tier="hard",
    ),
]
