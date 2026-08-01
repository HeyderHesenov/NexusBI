# NL→SQL eval harness — design

**Date:** 2026-08-02 · **Roadmap item:** Faza 1.5 · **Status:** implemented

## Why

Twenty-four copilot tools, the query pipeline, the dashboard planner and the
schema-linking step all shipped with **zero accuracy measurement**. Without a
number, no change to a prompt, a model or a retrieval step can be shown to have
helped rather than hurt — and the roadmap's sequencing rule makes this a blocker:
*no 25th copilot tool before the eval harness publishes an accuracy number.*

The harness publishes `nl2sql_exact@1` and gates on it.

## What is measured

`query_service._demo_pipeline(question)` — the same function `process_nl_query`
calls in demo mode. It renders the schema, calls `Text2SQLEngine.generate_sql`,
falls back to `rule_based_sql.generate_sql_fallback` on `AIGenerationError`,
applies the table allowlist and executes.

Measuring the production path is the point. A parallel "eval path" would measure
the harness. The returned `provenance` (`llm` / `deterministic_fallback`) tells
the runner which engine answered, so the run labels itself instead of trusting
configuration; a mismatch is reported as a broken harness, never scored as a
wrong answer.

**Out of scope, deliberately:** the live-datasource path (`_live_pipeline` needs
a real source, schema linking and RLS), Power BI/DAX, and copilot tool selection.
They can have their own golden sets later and reuse the grader and report here.

## Two engines, one golden set

| Engine | When | Cost | Gated |
|---|---|---|---|
| `deterministic_fallback` | every PR, inside `pytest -q` | $0 | **yes**, core tier |
| `llm` | `NEXUSBI_EVAL_LLM=1` | ~80 completions ≈ $0.22 | no, reported only |

The free run works because `tests/conftest.py` blanks `AI_API_KEY` and
`client._preflight` refuses before touching the network. The paid run therefore
needs the key through a *separate* variable, `NEXUSBI_EVAL_AI_KEY` — which also
means a stray `AI_API_KEY` in someone's environment can never silently turn a CI
run into a paid one.

The paid engine is never a gate: it is non-deterministic and costs money, and
neither belongs on someone else's pull request.

## Ground truth: reference SQL, not expected rows

Each case stores the SQL that answers the question. The runner executes the
candidate and the reference against **one** seeded snapshot
(`demo_data.execute_demo_snapshot`) and compares the two result sets.

Why not a dump of expected rows:

* `_seed` folds the live-feed multipliers into `revenue`, and `test_live_refresh`
  mutates those module-level factors — restoring them only if it completes.
  Literal values would then fail because of an unrelated test. The snapshot
  helper exists precisely for this ("all queries see identical data"), and the
  runner additionally pins the factors to 1.0 for its duration.
* A reference SQL is **readable in a diff**, so "is this the right answer to this
  question?" can be answered in review. A dump of 80 result sets cannot be.
* A change to the demo seed re-derives the reference automatically; it would
  invalidate all 80 dumps at once, and the only available fix — regenerate —
  is exactly the review-proof update that lets a real regression through.

**Its one weakness** is that a wrong reference passes silently. That is closed by
`expect`, which states the same answer a second way (`columns`, `rows` /
`rows_min`, and for stable single-cell answers `scalar`) and is verified by
`test_reference_sql_is_sane` independently of any candidate. It earned its keep
on the first run: a `region × category` cross declared as 25 rows is actually 5,
because `_seed` derives both from `i % 5` and they are perfectly correlated.
**Keep that in mind when authoring new cases — `region` and `category` are the
same dimension in the demo data.** (`region × month` is a genuine 60-row cross.)

## Grading: result-set equivalence

`tests/golden/grader.py`. Free to vary between two correct answers:

* **column names** — `total_revenue` vs `sum_rev`
* **column order** — `(category, total)` vs `(total, category)`
* **row order**, but only when `ordered: false`. Questions that name an order
  ("top 5", "ən çox satan", a time trend) set `ordered: true`.

Not free to vary: which values sit together in a row. Comparing columns
independently would pass a candidate that pairs every category with the wrong
revenue — both multisets still match. So the comparison always runs on whole row
tuples and the column bijection is *searched for*, pruned by per-column value
multisets and capped at 2000 attempts (the cap is only reachable when many
columns hold identical values; hitting it answers "not equivalent", which is the
safe direction for a number that must never over-report).

Values are normalized: floats to 2 places (the seed rounds there, and float
summation differs in the last bits by group order), `int`/`float`/`Decimal`
unified, strings stripped, `None` preserved and compared rather than dropped.

Column *count* must match exactly — a candidate returning an extra column is
scored wrong. This is the honest reading of "same answer", and it is why "name
and price of the 5 most expensive products" sits in the `full` tier: the
rule-based engine returns a fixed `name, price, stock_quantity` triple there.

**Known limitation** (shared with every execution-accuracy benchmark): a
candidate can be right by coincidence. `az-distinct-products-sold` is scored
correct because `COUNT(*) FROM products` and `COUNT(DISTINCT product_name) FROM
sales` are both 20 on this data. Reference-SQL grading cannot distinguish that
from understanding; only a larger, more separated dataset can.

## Tiers, and the ratchet

* **`core`** — the rule-based engine's documented envelope: aggregation by a
  dimension, top-N, counts, totals, time trends. 20 mirrored pairs.
* **`full`** — outside it: joins, filters, date ranges, `HAVING`, `DISTINCT`,
  subqueries, `AVG`, ratios, multi-dimension grouping. 20 mirrored pairs.

`CORE_FLOOR` sits at **1.00**, and the tier is what makes that sane: `core`
*means* "inside the envelope", so a question the engine cannot answer belongs in
`full`, not in core with the floor lowered to accommodate it. The engine is
deterministic, so an exact floor is the correct ratchet — any regression fails.

`test_core_floor_is_not_stale` fails once the score runs 0.10 clear of the floor,
so a real improvement gets locked in rather than quietly buying slack for a later
regression. Same shape as `test_architecture._UNLIMITED_MUTATING_ROUTES`.

The `full` tier is reported, never gated: it measures how far the product is from
a capable engine, and that number is supposed to move when the model changes.

## Adding a case

1. Append one JSON object per line to `backend/tests/golden/nl2sql.jsonl`, **in
   both languages**, sharing `reference_sql`, `tier` and `ordered`
   (`test_golden_set_is_mirrored_across_languages` enforces this — without it the
   language-parity number is a coincidence rather than a comparison).
2. Write `expect` from what you know of the demo data, *then* run
   `test_reference_sql_is_sane`. If they disagree, work out which side is wrong.
   Do not copy the observed shape in — that turns the check into a dump.
3. Pick the tier by reasoning about the rule-based engine, then confirm: a new
   `core` case that fails is either mis-tiered or a real gap worth fixing.

## Measured, 2026-08-02

Engine `deterministic_fallback`, 80 cases:

| slice | `nl2sql_exact@1` | |
|---|---|---|
| core (gated) | **1.00** | 40/40 |
| full | 0.03 | 1/40 |
| all | 0.51 | 41/80 |
| az | 0.53 | 21/40 |
| en | 0.50 | 20/40 |

A keyword heuristic scoring ~0 outside its envelope is the expected and correct
reading, not a failure — the roadmap anticipated it ("eval pis rəqəm qaytara
bilər… Bu *yaxşı* uğursuzluqdur"). The number's job is to make the gap between
the offline fallback and the real model visible for the first time, and to let
Faza 2 split its budget between features and quality by arithmetic.

## What the first run found

Three real bugs in `rule_based_sql`, all fixed in the same change:

1. **`"count"` matches inside `"country"`.** `any(w in q for w in _COUNT_WORDS)`
   read every `<measure> by country` question as a row count and answered a
   different question. The demo schema has a `country` column, so it fired
   constantly. Word-exact matching is not available as a fix — Azerbaijani is
   agglutinative and `"sayı"` must still match `"say"` — so the false friends
   (`country`, `countries`, `discount`, `account`) are blanked before the test.
2. **Time trends inherited the top-N `LIMIT 20`.** 48 distinct event dates became
   the first 20, silently reshaping the chart. Monthly trends never exposed it
   because 12 < 20. Trends now use `_TREND_LIMIT` unless the question names a
   number.
3. **English `-y → -ies` plurals matched nothing.** `"categories"` does not
   contain `"category"`, so the dimension was dropped entirely and the question
   fell through to an unrelated top-N.

Two of the three were English-only, which is why fixing them closed most of the
language gap (en 0.42 → 0.50) and took core from 0.90 to 1.00.

## Running it

```bash
cd backend
pytest -q                                   # eval included, free, gated
cat eval-report.json                        # full detail incl. per-case SQL

NEXUSBI_EVAL_LLM=1 NEXUSBI_EVAL_AI_KEY="$AI_API_KEY" \
  pytest tests/test_eval_nl2sql.py -m eval_llm -q -s     # paid, ~$0.22
```

CI runs the free eval inside the existing `Backend (ruff + pytest)` job and
publishes the table to the job summary plus a `nl2sql-eval-report` artifact —
no new job, so the branch ruleset's required checks are unchanged.
