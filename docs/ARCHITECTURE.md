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
| API | `api/v1/*` | Thin routers: auth, query, datasource, dataprep, dashboard, metric, saved_query, billing, branding, decision, integration, copilot, requirement, scenario, workspace, public, ws |
| Schemas | `schemas/*` | Pydantic request/response contracts |
| Services | `services/*` | Business logic: query_service, datasource_service, dashboard_service, metric_service, saved_query_service, scheduler, alert_service, insight_service, decision_service, cache_service, upload_service, billing/usage_service, digest_service, requirement_service, data_prep_service, profiling_service, lineage_service, workspace_service, rls_service, **rls_sql (SQL-level RLS), auth_token_service (refresh rotation)**, audit_service, scenario_service, kpi_target_service, integration_service, integrations, embed_service, brand_service, powerbi/* |
| AI | `ai/*` | text2sql, text2dax, chart_selector, insight_generator, insight_digest, analysis (forecast/anomaly/explain), **root_cause, requirements, data_prep**, dashboard_planner, data_story, copilot, sql_guard, schema_introspector, rule_based_sql/dax, prompt_templates, client |
| Models | `models/*` | SQLAlchemy 2.0 models |
| Core | `core/*` | security (JWT/Fernet, **embed token**), exceptions (+ ForbiddenError), metrics, logging, google, net_guard (SSRF), rate_limit |
| Realtime | `realtime/*` | hub (collab WS pub/sub), live_refresh (canlı dashboard loop) |
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
   - **Pipeline**: schema (cached) → `text2sql` (AI engine, 3 retries, JSON) →
     `sql_guard.validate_select_only` (+ metadata denylist / schema allowlist / timeout) →
     **RLS injected into SQL** (`rls_sql.constrain_sql`) → execute via a **pooled engine**
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
- **Augmented analytics:** `analysis.explain` (flat root-cause drivers) and
  `root_cause.decompose` (hierarchical "Why?" tree, AI shape validated inside the service
  with a deterministic fallback) are on-demand AI calls; `lineage_service` derives source
  tables/columns/metrics from the stored SQL deterministically (no AI). What-if is client-side.
- **Proactive AI digest:** `digest_service` scans a user's recent distinct queries
  (`insight_service.scan_recent_distinct`, shared helper) and rolls notable changes — with a
  driver/reason — into ONE "🌅 Səhər brifi" notification. The scheduler runs it once/day past
  `DIGEST_HOUR_UTC`; also on-demand via `POST /notifications/digest`. Rule-based fallback offline.
- **Agentic copilot:** `ai/copilot` is a bounded tool-calling loop (`COPILOT_MAX_STEPS`); tools
  are owner-scoped (user_id injected, never from the model) and delegate to existing services
  (run_query, create/generate dashboard, add_widget, share, save query, define metric, digest).
  Two modes: `plan` (propose steps, no execution, no quota) and `execute` (run; 1 quota unit,
  the approved plan is injected so execution follows it).
- **Requirements → dashboard:** `ai/requirements.extract_kpis` turns a BRD/user-story into
  measurable KPIs (AI + rule-based fallback); `requirement_service.build` runs them through the
  shared `dashboard_service.assemble_dashboard`. `requirement_docs` table links the doc→dashboard.
- **NL data-prep + profiling:** `ai/data_prep.plan_transform` produces a single SELECT (joins/
  aggregations) over the demo or a real source; `data_prep_service` previews then materializes
  the result as a new SQLite data source (`upload_service.materialize_rows`). `profiling_service`
  returns per-column stats from a bounded sample; the table name is validated against the live
  schema before interpolation. All paths re-apply `sql_guard.validate_select_only`.
- **Trust layer:** metrics carry `verified`/`verified_by`/`verified_at` (certification badge);
  data sources carry `freshness_sla_hours`/`last_refreshed_at` (stale flag). `metric_service.set_verified`
  and `datasource_service.set_sla`/`stamp_refreshed` manage them.
- **Workspaces / RBAC:** `workspaces` + `workspace_members` (role viewer<editor<owner);
  `workspace_service.require_role` gates membership ops; the workspace owner can't be self-demoted.
- **Row-level security (RLS):** `rls_rules` (per-member allowed value on a datasource column).
  Primary enforcement is **SQL-level** — `rls_sql.constrain_sql` (sqlglot) AND-s a
  `CAST(tbl.col AS TEXT) IN (...)` predicate into each protected table's SELECT scope **before**
  aggregation, so SUM/GROUP BY can't leak filtered rows; case-insensitive table match, CTE-shadow
  aware, **fail-closed** if a protected table can't be constrained. Post-fetch `rls_service.apply`
  remains a fallback. Enforced in `query_service._live_pipeline` AND `reexecute_logged_query`
  (dashboard refresh); the live-broadcast path re-applies it too. NOTE: data sources are still
  personal — full team-sharing of a source (resource `workspace_id`) is the documented next step.
- **Audit log:** `audit_service.log` appends to `audit_logs` on security-relevant actions
  (datasource create/delete, RLS create/delete, workspace member changes); `GET /audit` lists.
- **Scenario planning:** `scenario_service` (numpy, no AI, deterministic) — `goal_seek`,
  `monte_carlo` (seeded, P10/P50/P90), `pacing`. `kpi_targets` + `kpi_target_service` for goals.
  Exposed as non-AI compute endpoints (`/query/{id}/goal-seek` · `/monte-carlo`, `/kpi-targets`).
- **Workflow integrations:** `integrations.deliver` is mock-first (`INTEGRATIONS_LIVE` False →
  logged) with real Slack/Teams webhooks (httpx, no-redirect, SSRF re-checked at delivery) and
  SMTP email. `integration_service.dispatch` fans digest/alert notifications to a user's
  `integration_channels` (Fernet-encrypted target). `@mention` in comments notifies in-app ONLY
  (no third-party fan-out — anti cross-tenant phishing), capped per comment.
- **Realtime:** `realtime/hub` is an in-process WS pub/sub (collab cursors + chat); `live_refresh`
  re-runs live dashboards' widget SQL (data-only) on an interval and pushes over the WS.
- **Decision log:** `decisions` (insight→action→outcome + status) via `decision_service`.
- **Sharing / embed:** `dashboards.share_token` (public read-only snapshot, no auth) AND
  `dashboards.embed_enabled` + a signed embed token (`security.create_embed_token`, `emb` claim);
  `embed_service.resolve` re-checks `embed_enabled` so disabling instantly revokes all tokens.
  `GET /public/embed/{token}` serves the dashboard + the owner's white-label `brand_configs`
  (app_name/primary_color/logo_url, server-validated against injection). `public/embed.js`
  auto-mounts an iframe in third-party pages.
- **Billing / tiers:** `billing/tiers` is the single source of truth for quotas;
  `usage_service` enforces a monthly window. `POST /upgrade` is a demo mock; `POST /checkout`
  is a config-gated real Stripe Checkout (no `STRIPE_SECRET_KEY` → refused).
- **Auth / refresh tokens:** register/login issue an **access + refresh pair** (`auth_token_service.issue_pair`).
  `POST /auth/refresh` rotates the refresh token (`rotate`, `SELECT ... FOR UPDATE`) and **detects reuse**
  — a replayed token revokes the whole family. `POST /auth/logout` revokes it. Access TTL is short
  (`ACCESS_TOKEN_EXPIRE_MINUTES`, default 30); refresh lives `REFRESH_TOKEN_EXPIRE_DAYS`. `get_current_user`
  rejects non-`sub` claims, so refresh/ws/embed tokens can't be used as access tokens. Frontend
  `tokenStore` does single-flight 401-refresh.
- **CI:** `.github/workflows/ci.yml` runs ruff + pytest (backend) and build (frontend) on push/PR.
- **Observability:** `core/metrics` (Prometheus) exposes HTTP/AI/SQL counters at
  `/metrics`; structured logs via structlog.

## Data model (app DB)

`users` (1)─<(N)) `datasources`, `query_logs`, `dashboards`, `saved_queries`, `metrics`,
`alerts`, `notifications`, `decisions`, **`requirement_docs`, `kpi_targets`,
`integration_channels`, `workspaces`, `workspace_members`, `rls_rules`, `audit_logs`,
`brand_configs` (1:1), `refresh_tokens`**; `dashboards` (1)─<(N) `widgets` and `dashboard_comments`;
`alerts` → `saved_queries`; `widgets.query_log_id` → `query_logs`; `rls_rules` →
`datasources` (+ owner/member → `users`); `workspace_members` → `workspaces`;
`query_logs.datasource_id` / `metrics.datasource_id` / `saved_queries.datasource_id` → `datasources`.

Latest schema change: the **`refresh_tokens`** table (rotation + reuse-detection), migration
`e7f8a9b0c1d2`. Earlier this cycle: `users.last_digest_at`; `metrics.verified`/`verified_by`/
`verified_at`; `datasources.freshness_sla_hours`/`last_refreshed_at`; `dashboards.embed_enabled`.
Migrations are Alembic, chained under `db/migrations/versions`; current head = **`e7f8a9b0c1d2`**.

## Notable architecture deltas (this round)

- `dashboard_service.assemble_dashboard` was extracted so AI auto-dashboard and
  requirements→dashboard share one fan-out path; `dashboard_service.to_response` is now the
  single source of truth for every dashboard response shape (dashboard/requirement routers reuse it).
- `insight_service.scan_recent_distinct` is a shared recent-history scan used by both smart
  insights and the proactive digest (dedup by lowercased NL, skip empty results).
- The query **result cache key is now user-scoped** (`qcache:{ds}:{sha1(user|nl|context)}`) — two
  users can have different metrics AND RLS rules, so a shared key could leak RLS-filtered rows.
- `datasource_service.execute_select` de-duplicates duplicate output column names (joins with
  `SELECT *`), building rows positionally so no column is silently dropped.
- SQLite engine gets a busy timeout; the requirements-build path commits its read transaction
  before the concurrent widget fan-out (avoids a SQLite writer deadlock) — gated to sqlite.
- A new JWT claim type `emb` (embed) joins `sub` (access) and `ws` (collab ticket); each decoder
  requires its own claim, so token kinds can't be cross-used. A `rt` (refresh) claim was added
  the same way — `get_current_user` and the WS resolver reject every non-`sub` claim.
- **RLS moved into the SQL** (`rls_sql.constrain_sql`, sqlglot): the old post-fetch Python filter
  leaked aggregates (SUM/GROUP BY), so the predicate is now injected before aggregation; post-fetch
  is the fallback. Cache key invalidation and the live-broadcast path were updated to respect it.
- **Refresh-token rotation** (`auth_token_service`, `refresh_tokens` table): rotate-on-use +
  reuse-detection family-revoke; access TTL cut 60→30 min.
- **CSP** is emitted at build time (Vite plugin: `script-src 'self'` + per-chunk hash + Google).
- **Frontend hardening:** `ErrorBoundary` (route + per-widget), `ModalShell` (focus-trap/
  scroll-lock/aria-modal), and `React.lazy` for chart panels (smaller initial bundle). Vitest set up.

## Security model

- SELECT-only SQL guard (literal-aware), re-validated at the executor; row caps. Applies to
  every SQL sink incl. NL data-prep and profiling (table name validated against live schema).
- All queries scoped by `user_id`/`owner_id` (IDOR protection); widgets can't attach foreign
  logs; the query result cache key is user-scoped (no RLS leak via shared cache).
- **RLS** is fail-closed, enforced **in the generated SQL** (before aggregation) on both read
  paths (live + dashboard refresh), with a post-fetch fallback.
- **Auth tokens**: short-lived access + rotating refresh with reuse-detection (family-revoke);
  each token kind carries a distinct claim and can't be substituted for another.
- **Text2SQL hardening**: metadata-table denylist (quote-bypass resistant), schema allowlist
  (rejects schema-qualifier escapes), statement timeout on Postgres/MySQL.
- **CSP / headers**: build-time Content-Security-Policy; security headers on error responses too;
  `/docs` disabled in prod; `/metrics` gated (loopback in demo, bearer in prod).
- **SSRF**: `net_guard` on datasource connections and integration webhooks, re-checked at
  delivery time (DNS-rebind window); webhooks never follow redirects, only 2xx = success.
- **Embed**: signed read-only `emb` token; disabling embed instantly revokes; white-label
  brand fields are server-validated (no tag injection / `javascript:` URLs).
- **@mention** notifies in-app only (no outbound fan-out to other tenants' channels), capped.
- JWT on protected endpoints; Fernet-encrypted secrets (connection strings + integration
  targets); prod fails fast without strong `SECRET_KEY`/`FERNET_KEY`. Secrets never returned
  to clients. A final cross-cutting pentest pass confirmed the new surface; findings fixed.

## Conventions / decisions

- Async end-to-end (SQLAlchemy async, httpx, AI-engine async client).
- Services hold logic; routers stay thin. New domain → model + schema + service +
  router, registered in `api/v1/router.py` and `models/__init__.py`, with an Alembic
  migration.
- Graceful degradation over hard dependency (Redis, scheduler, Google all optional).
- Frontend theming via CSS-variable tokens (light/dark) consumed by Tailwind;
  emerald accent, Source Serif 4 display. State in small Zustand stores per domain.
