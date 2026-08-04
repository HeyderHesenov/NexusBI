# `query_logs.data_as_of` — design

**Date:** 2026-08-04 · **Roadmap item:** Faza 1.7 follow-up · **Status:** implemented

## Why

`metric_tree_service` shows every measured leaf a `measured_at` stamp, and reads
it from `saved_queries.last_run_at`. That stamp answers "when did the run
happen", but the number it labels answers "when was the data fetched" — and two
production paths break the equivalence in **opposite directions**:

- **Cache hit.** `query_service.process_nl_query` serves a repeated question from
  the result cache and `_finalize` persists that cached snapshot under a **fresh**
  `QueryLog`. `saved_query_service.run()` then stamps `last_run_at = now`. The
  rows can be up to `CACHE_TTL_SECONDS` (300 s) older than the stamp claims.
  The tree **overstates** freshness.
- **In-place widget refresh.** `dashboard_service.refresh_widget_data` re-executes
  a widget's stored SQL and overwrites `log.result_data` on the **same log row**,
  leaving `created_at` and `last_run_at` untouched. The tree **understates**
  freshness — and the displayed number can change with no stamp movement at all.

That second path is reachable, not theoretical: `add_widget`
(`dashboard_service.py:479-487`) accepts a client-supplied `query_log_id` and only
checks ownership, so a user can attach a widget to the very log a saved query's
`last_query_log_id` points at.

`QueryLog` carries only `created_at` (`TimestampMixin` has no `updated_at`), so
today there is no truer timestamp to read. This change persists one.

## What changes

One nullable column, three write sites, one read.

```python
# app/models/query_log.py
data_as_of: Mapped[datetime | None] = mapped_column(
    DateTime(timezone=True), nullable=True
)
```

| Site | Change |
|---|---|
| `query_service.py` cache payload | gains `"fetched_at"` — when the rows were actually fetched (miss path only) |
| `query_service._finalize` | new `data_as_of` argument, written onto the log: miss → **the same timestamp written into the cache payload**, hit → the payload's `fetched_at` |
| `dashboard_service.refresh_widget_data` | sets `log.data_as_of = now` beside the rewritten rows — this path genuinely re-executed |
| `metric_tree_service.resolve_leaf` | `measured_at = to_instant(log.data_as_of) or aware(sq.last_run_at)` |
| `query_service.run_user_sql` | stamps its own fetch — `_finalize`'s argument is required, so this path cannot silently write NULL |

`log` is guaranteed non-`None` at the read: the `rows` guard above it returns
`result_missing` first.

## Decisions and their reasons

**A real column, not a key inside `result_data`.** The JSON option needs no
migration, which is its whole appeal. It loses on four counts:

1. `result_data` is **wholesale-replaced** in both write sites
   (`query_service._finalize`, `dashboard_service.refresh_widget_data` — named,
   not line-numbered, because line numbers in this file went stale within the
   same change that introduced them). A sibling key dropped by
   a future third writer fails **silently** — straight back to `last_run_at`,
   the exact lie being fixed. A column cannot be lost by forgetting.
2. `result_data` is nullable. The stamp would vanish precisely when a run failed
   or RLS denied it.
3. Faza 4 carries metric certification and audit coverage. A certified number
   needs a queryable "as of"; filtering on a JSON key inside a 1000-row snapshot
   is the mistake `_columns_expr` already exists to avoid.
4. No `server_default` is declared, so the schema-drift baseline is untouched —
   that ratchet's 55 accepted differences are all `server_default` mismatches.

**No backfill.** Rows written before this column stay NULL and readers fall back
to `last_run_at`, which is today's behaviour. Backfilling `created_at` would
*materialise* the very overstatement being fixed for every row that was a cache
hit.

**`saved_query_service.run()` keeps using the cache.** Forcing `bypass_cache=True`
was considered and rejected on measured cost. On a miss the pipeline runs
`select_chart_type` and `generate_insight`, both **uncached LLM completions**
(only NL→SQL generation is cached, 900 s) — roughly 2 completions ≈ $0.0056 per
run at the measured $0.00279/completion. What it buys is close to nothing:
scheduled runs are ≥1 h apart against a 300 s cache, so they **already** always
miss; the only behaviour that changes is a manual re-run inside five minutes,
where the alert path is suppressed by cooldown anyway. Once `data_as_of` exists
the cache hit is no longer a lie — the new log carries the original fetch time —
so the freshness problem is closed without paying for it.

## Edge cases

- **Cache entries in flight across the deploy** were written by the old code and
  carry no `fetched_at` → `data_as_of` stays NULL → the read falls back to
  `last_run_at`. Self-draining within `CACHE_TTL_SECONDS`; no migration step.
- **Timezone.** The payload is JSON, so the stamp round-trips as an ISO string and
  is read back through `core.timeutil.aware`. A missing or unparseable value is
  treated as NULL rather than raising.

## Tests

Each must fail against the current code — the repo's discrimination-power rule.

1. A cache hit's new log carries the **first** fetch time, not `now`.
2. `refresh_widget_data` moves `data_as_of` while `created_at` stays put.
3. The user-visible claim: a leaf's `measured_at` reports the data age, so
   `measured_at < last_run_at` after a cache hit.
4. A legacy NULL falls back to `last_run_at` — no `None` leaks into the AI payload.
5. Migration up → down → up. **Not an automated test — verified by execution
   instead**, on a throwaway `nexusbi_asof_probe` Postgres database that was
   dropped afterwards. There is no automated one because the unit suite never
   runs migrations at all (`conftest.py` builds the schema straight off the
   models with `create_all` and stamps `alembic_version` by hand), so a test
   here would assert against a schema this file never produced. A real
   migration harness is a separate ticket; until it exists, a broken
   `downgrade` surfaces only on a rollback.

## Also in this change: delivery delete no longer lies

`ReportsPage`'s `DeliveryModal.del` swallows the rejection (`.catch(() => undefined)`) and
filters the row out regardless, so a failed delete reads as "it's gone" while the
scheduled report keeps sending. The fix is the shape already sitting at
`:204-214` in the same file, where `AlertModal.del` was corrected during Faza 1.6:
await inside `try`, drop the row only after the server confirms, leave the toast
to the interceptor. No new i18n keys.
