# NexusBI — Architecture

Concise reference for how the system is structured and why. For setup/usage see the
root [`README.md`](../README.md).

## High level

NexusBI is a natural-language BI platform: a user asks a question in plain language,
the backend turns it into safe SQL, runs it against a data source, and returns a
chart + insight. A React SPA talks to an async FastAPI backend over JSON.

```
React SPA (Vite/TS/Zustand/Recharts)  ──HTTP/JSON──▶  FastAPI (async)
                                                         │
                                  ┌──────────────────────┼───────────────────────┐
                                  ▼                       ▼                        ▼
                            app DB (Postgres/SQLite)   Redis cache         user data sources
                            users, datasources,        (query results +    (Postgres/SQLite,
                            query_logs, dashboards,      schema)            CSV/Excel→SQLite)
                            widgets, saved_queries,
                            metrics
```

## Backend layout (`backend/app`)

| Layer | Path | Responsibility |
|-------|------|----------------|
| API | `api/v1/*` | Thin routers: auth, query, datasource, dashboard, metric, saved_query, billing |
| Schemas | `schemas/*` | Pydantic request/response contracts |
| Services | `services/*` | Business logic (query_service, datasource_service, dashboard_service, metric_service, saved_query_service, scheduler, alert_service, decision_service, cache_service, upload_service, billing/usage_service) |
| AI | `ai/*` | text2sql, chart_selector, insight_generator, analysis (forecast/anomaly/explain), sql_guard, schema_introspector, prompt_templates, client |
| Models | `models/*` | SQLAlchemy 2.0 models |
| Core | `core/*` | security (JWT/Fernet), exceptions, metrics, logging, google |
| DB | `db/*` | engine/session, engine_pool, migrations (Alembic), demo_data |

## Request flow — `POST /query/ask`

1. **Auth + rate limit** — `RateLimitedUser` dependency resolves the JWT user and
   consumes one monthly AI quota unit (`billing/usage_service`); 429 if exhausted
   (the `unlimited` demo tier bypasses).
2. **`query_service.process_nl_query`**:
   - Build **extra_context** = metric catalog (`metric_service.metrics_as_prompt`) +
     previous turn (chat follow-up) — injected into the Text2SQL prompt.
   - **Cache** check (Redis, key = `qcache:{ds}:{sha1(nl|context)}`). Hit → return
     without AI/DB (still records a QueryLog).
   - **Pipeline**: schema (cached) → `text2sql` (gpt-4o, 3 retries, JSON) →
     `sql_guard.validate_select_only` → execute via a **pooled engine**
     (`db/engine_pool`) → `chart_selector` + `insight_generator` run concurrently.
   - Snapshot rows once → cache + persist `QueryLog` → return `QueryResult`.
3. Errors raise `NexusBIException` (mapped to JSON with `sql` surfaced for query failures).

## Key subsystems

- **Semantic layer (metrics):** user-defined metric definitions (name/expression/
  synonyms) per data source (or global). Injected as prompt context so NL→SQL stays
  consistent. Source of truth: `metrics` table + `metric_service`.
- **Chat / multi-turn:** `previous_query_log_id` carries the prior question+SQL into
  the prompt; included in the cache key so follow-ups don't collide.
- **Data sources:** connection strings encrypted at rest (Fernet). CSV/Excel uploads
  are ingested (`upload_service`, pandas) into a per-source SQLite file and registered
  as a normal `sqlite` data source — so the same NL→SQL→guard path applies.
- **Connection pooling:** `db/engine_pool` keeps one `AsyncEngine` (with its pool) per
  connection string in a bounded async-locked LRU; disposed on shutdown / source delete.
- **Caching & schema:** `cache_service` is a thin Redis wrapper that degrades to a no-op
  when Redis is absent. Caches query results (TTL) and introspected schema (1h).
- **Dashboards:** `widgets` reference a `query_log`; the embedded chart snapshot carries
  its data source name. Refresh re-runs the widget's query (cache-bypass). Cross-filter
  is client-side (a click filters every widget sharing that field).
- **Saved queries + scheduler:** `saved_queries` rows; an in-process asyncio loop
  (`services/scheduler`) refreshes due ones (hourly/daily/weekly) into a fresh QueryLog.
- **Alerts & notifications:** an `alerts` row (threshold on a saved query's column) is
  evaluated by `alert_service` whenever that saved query runs (scheduler or manual); a
  breach writes a `notifications` row (bell + Notifications page).
- **Augmented analytics:** `analysis.explain` (root-cause drivers) is an on-demand AI call
  per result (like forecast/anomaly), rate-limited; what-if is pure client-side math.
- **Decision log:** `decisions` (insight→action→outcome + status) link an insight to a
  tracked decision via `decision_service`; optional `query_log_id` back-reference.
- **Sharing / embed:** `dashboards.share_token` (nullable, unique). Public router
  `api/v1/public` serves a read-only snapshot by token with NO auth, scoped to the owner's
  user_id (snapshot only — no datasource secrets). Revoke clears the token.
- **Billing / tiers:** `billing/tiers` is the single source of truth for quotas;
  `usage_service` enforces a monthly window. Upgrade is a mock (Stripe-ready).
- **CI:** `.github/workflows/ci.yml` runs ruff + pytest (backend) and build (frontend) on push/PR.
- **Observability:** `core/metrics` (Prometheus) exposes HTTP/AI/SQL counters at
  `/metrics`; structured logs via structlog.

## Data model (app DB)

`users` (1)─<(N)) `datasources`, `query_logs`, `dashboards`, `saved_queries`, `metrics`,
`alerts`, `notifications`, `decisions`; `dashboards` (1)─<(N) `widgets`; `alerts` → `saved_queries`;
`widgets.query_log_id` → `query_logs`;
`query_logs.datasource_id` / `metrics.datasource_id` / `saved_queries.datasource_id` → `datasources`.
Migrations are Alembic, chained under `db/migrations/versions`.

## Security model

- SELECT-only SQL guard (literal-aware), re-validated at the executor; row caps.
- All queries scoped by `user_id` (IDOR protection); widgets can't attach foreign logs.
- JWT on protected endpoints; Fernet-encrypted secrets; prod fails fast without
  strong `SECRET_KEY`/`FERNET_KEY`. Connection strings are never returned to clients.

## Conventions / decisions

- Async end-to-end (SQLAlchemy async, httpx, OpenAI async client).
- Services hold logic; routers stay thin. New domain → model + schema + service +
  router, registered in `api/v1/router.py` and `models/__init__.py`, with an Alembic
  migration.
- Graceful degradation over hard dependency (Redis, scheduler, Google all optional).
- Frontend theming via CSS-variable tokens (light/dark) consumed by Tailwind;
  emerald accent, Source Serif 4 display. State in small Zustand stores per domain.
