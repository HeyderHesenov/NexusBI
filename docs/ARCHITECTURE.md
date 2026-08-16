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
                            metrics, decisions(+measurements),
                            query_embeddings, ai_spend_daily
```

## Backend layout (`backend/app`)

| Layer | Path | Responsibility |
|-------|------|----------------|
| API | `api/v1/*` | Thin routers: auth, query, datasource, dataprep, dashboard, **snapshot**, metric, **metric_tree**, saved_query, billing, branding, decision, integration, copilot, requirement, **ba**, **automl**, scenario, workspace, **data_contract**, **alert**, **search**, **graph**, public, ws |
| Schemas | `schemas/*` | Pydantic request/response contracts |
| Services | `services/*` | Business logic: query_service, datasource_service, dashboard_service, metric_service, saved_query_service, scheduler, alert_service, insight_service, decision_service, cache_service, upload_service, digest_service, requirement_service, data_prep_service, profiling_service, lineage_service, workspace_service, rls_service, **rls_sql (SQL-level RLS incl. deny-all wrapper), auth_token_service (refresh rotation)**, audit_service, scenario_service, kpi_target_service, integration_service, integrations, embed_service, brand_service, powerbi/*, **report_renderer (PDF/Excel), report_delivery_service**, **explore_service, snapshot_service, graph_service, graph_view_service, ba_service, automl_service** |
| AI | `ai/*` | text2sql, text2dax, chart_selector, insight_generator, insight_digest, analysis (forecast/anomaly), root_cause, requirements, data_prep, dashboard_planner, data_story, copilot, **retrieval (RAG vector grounding)**, sql_guard, schema_introspector, **schema_linking (wide-schema table selection: embed+cosine top-K + FK closure, metadata-only)**, rule_based_sql/dax, prompt_templates, **call_context (per-request AI call counter → proportional quota)**, **search (global asset semantic search)**, **ba_frameworks (SWOT/Porter/BCG/BPMN + mermaid sanitizer), textparse (shared AI-text parsing)**, **client (chat + embed)** |
| Billing | `billing/*` | tiers (single source of truth for quotas), usage_service (monthly AI quota), **cost (per-call USD accounting + daily ceiling)** |
| Models | `models/*` | SQLAlchemy 2.0 models |
| Core | `core/*` | security (JWT/Fernet, **embed token**), exceptions (+ ForbiddenError), metrics, logging, google, net_guard (SSRF), rate_limit (Redis-backed, per-process fallback), **leader (scheduler lease), health (/live + /ready), sql_ident (dialect-aware quoting)** |
| Realtime | `realtime/*` | hub (WS rooms, per-worker), **bus (cross-worker eviction; delivery + presence behind a flag)**, live_refresh (canlı dashboard loop) |
| DB | `db/*` | engine/session, engine_pool, migrations (Alembic), demo_data |

## Request flow — `POST /query/ask`

1. **Auth + rate limit** — `RateLimitedUser` dependency resolves the JWT user and
   consumes monthly AI quota (`billing/usage_service`) — **in proportion to the calls the
   request actually makes**, reconciled from `ai/call_context` in the request's OWN session; 429 if exhausted
   (the `unlimited` demo tier bypasses).
2. **`query_service.process_nl_query`**:
   - Build **extra_context** = metric catalog (`metric_service.metrics_as_prompt`) +
     previous turn (chat follow-up) — the **stable** context used for the cache key.
   - **Cache** check (Redis, key = `qcache:{ds}:{sha1(user|nl|context)}`). Hit → return
     without AI/DB (still records a QueryLog).
   - **RAG grounding (cache miss only):** `ai/retrieval.retrieve_context` appends the most
     similar prior queries + verified metrics to a **prompt_context** (user-scoped numpy cosine
     over `query_embeddings`) — added to the generation prompt **only**, never to the cache key,
     so a self-indexed example can't bust the repeat-question cache.
   - **Pipeline**: schema (cached) → `text2sql` (AI engine, 3 retries, JSON) →
     `sql_guard.validate_select_only` (+ metadata denylist / schema allowlist / timeout) →
     **RLS injected into SQL** (`rls_sql.constrain_sql`) → execute via a **pooled engine**
     (`db/engine_pool`) → `chart_selector` + `insight_generator` run concurrently.
   - Snapshot rows once → cache + persist `QueryLog` → **index-on-write** (`retrieval.index_text`
     embeds the fresh NL→SQL pair, best-effort) → return `QueryResult`.
3. Errors raise `NexusBIException` (mapped to JSON with `sql` surfaced for query failures).

**Manual SQL path (`query_service.run_user_sql`, `POST /query/run`):** the power-user
entry point runs analyst-authored SQL with **no AI** — `sql_guard.validate_select_only`
first (cheap DML/DDL/multi-statement reject), then the shared **`_guarded_execute`** helper
(table allowlist → per-viewer RLS `constrain_sql` → pooled `execute_select`). That helper is
the single source of truth for the live-source guard chain, reused by `_live_pipeline`,
`reexecute_logged_query`, and `run_user_sql`, so a guard can't drift onto one path only.
Charts are picked **rule-based** (`chart_selector.rule_based_chart`), no insight is generated,
and the run persists a `QueryLog` (label `[SQL] …` in `natural_language`; no migration) so history,
dashboards, and the analysis panels keep working. Demo/no-datasource is gated on `DEMO_MODE`
(rejected in prod) and the demo executor caps rows (`fetchmany`). Power BI sources are rejected
(DAX ≠ SQL). Rate-limited per-IP (`sql_run`, no AI quota).

## Key subsystems

- **Semantic layer (metrics):** user-defined metric definitions (name/expression/
  synonyms) per data source (or global). Injected as prompt context so NL→SQL stays
  consistent. Source of truth: `metrics` table + `metric_service`.
- **Chat / multi-turn:** `previous_query_log_id` carries the prior question+SQL into
  the prompt; included in the cache key so follow-ups don't collide.
- **Data sources:** connection strings encrypted at rest (Fernet). CSV/Excel uploads
  are ingested (`upload_service`, pandas) into a per-source SQLite file and registered
  as a normal `sqlite` data source — so the same NL→SQL→guard path applies.
- **Replace-in-place refresh** (`datasource_service.replace_data`, `PATCH /datasource/{id}/data`):
  re-ingests a fresh CSV/Excel onto the **SAME** sqlite datasource row (id preserved → queries,
  widgets, and RLS stay wired). Evicts the old engine, clears `schema:`/`profile:`/`qcache:` caches,
  deletes the orphaned .db (confined to `UPLOAD_DIR`), re-stamps freshness, and returns schema-loss
  warnings (columns/tables present before but gone after). sqlite-only.
- **One-click Explore** (`explore_service.build_explore_dashboard`, `POST /datasource/{id}/explore`):
  a deterministic, **AI-free** X-ray dashboard. Classifies measures/dims/temporals from a guarded
  200-row sample of the widest table, composes KPI/time-series/top-N/count SELECTs (≤8 widgets,
  dialect-aware quoting), each run through the shared guard chain. Reuses two extracted helpers:
  `query_service.guarded_read` (the guarded read half of `run_user_sql`, no persisted QueryLog) and
  the now-public `dashboard_service.layout_widgets`. Power BI sources are rejected.
- **Connection pooling:** `db/engine_pool` keeps one `AsyncEngine` (with its pool) per
  connection string in a bounded async-locked LRU; disposed on shutdown / source delete.
- **Caching & schema:** `cache_service` is a thin Redis wrapper that degrades to a no-op
  when Redis is absent. Caches query results (TTL) and introspected schema (1h).
- **Dashboards:** `widgets` reference a `query_log`; the embedded chart snapshot carries
  its data source name. Refresh re-runs the widget's query (cache-bypass). Cross-filter
  is client-side (a click filters every widget sharing that field).
- **Saved queries + scheduler:** `saved_queries` rows; an asyncio loop
  (`services/scheduler`) refreshes due ones (hourly/daily/weekly) into a fresh QueryLog.
  Every worker runs the loop but only the one holding the Redis lease acts (`core/leader`) —
  its work has external side effects (email, Slack, LLM spend), so N workers would
  otherwise mean N deliveries. With no reachable Redis the loops stand down and log why,
  rather than duplicating silently; `SCHEDULER_REQUIRE_LOCK=false` opts a genuinely
  single-process deployment back in.
- **Alerts & notifications:** an `alerts` row (threshold on a saved query's column) is
  evaluated by `alert_service` whenever that saved query runs (scheduler or manual); a
  breach writes a `notifications` row (bell + Notifications page).
- **Augmented analytics:** `root_cause.decompose` (hierarchical "Why?" tree, AI shape validated inside the service
  with a deterministic fallback) is an on-demand AI call; `lineage_service` derives source
  tables/columns/metrics from the stored SQL deterministically (no AI). What-if is client-side.
- **Proactive AI digest:** `digest_service` scans a user's recent distinct queries
  (`insight_service.scan_recent_distinct`, shared helper) and rolls notable changes — with a
  driver/reason — into ONE "Səhər brifi" notification. The scheduler runs it once/day past
  `DIGEST_HOUR_UTC`; also on-demand via `POST /notifications/digest`. Rule-based fallback offline.
- **Agentic copilot (universal executor):** `ai/copilot` is a bounded tool-calling loop
  (`COPILOT_MAX_STEPS`) with a **24-tool registry that drives every product feature**: discovery
  tools (`search_assets` + `list_*` so the model finds ids instead of inventing them), queries/
  dashboards, AutoML train+predict, BA Studio generate, snapshots,
  decisions create/measure, insight scan, data-contract run, metric-tree
  evaluate + twin `simulate` (single backend home: `metric_tree_service.simulate`), alerts.
  The metric-tree tools carry **provenance per leaf** (`measured`/`manual`/`unknown` + origin and
  measurement time) and attach the reporting constraint to the tool RESULT, not only to
  `SYSTEM_PROMPT`: a rule stated once at the top of a long tool-calling session competes with
  everything since, while one travelling with the data is read where it applies. Same reasoning as
  `ba_evidence` refusing to let the model self-attribute evidence.
  Tools are owner-scoped (user_id injected, never from the model) and delegate to existing
  services. Two modes: `plan` (propose steps, no execution, no quota) and `execute` (run;
  1 quota unit, the approved plan is injected so execution follows it). Guardrails: dispatch
  allowlist (only TOOLS names reach `getattr`), NO delete tools, per-tool heavy cap
  (`_HEAVY_TOOLS`, 2/turn), and tools mirroring per-IP-guarded endpoints share those endpoints'
  rate buckets (`_IP_BUCKETS` + client ip) so the agent path can't bypass limits. Action chips
  carry typed ids (`CopilotAction`); the frontend maps them to routes in `lib/copilotNav.ts`,
  with `?open=` deep-links consumed by `hooks/useOpenParam` on the BA/AutoML pages.
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
- **Answer trust signal (provenance + confidence):** every `QueryLog` records how its SQL was
  produced — `provenance` ∈ {`llm`, `self_repaired` (repaired from the DB error), `deterministic_fallback`
  (offline rule-based), `user_sql` (analyst-authored)} — plus a `confidence` score. Both are set in
  `query_service._finalize`, surfaced on `QueryResult`/`QueryHistoryItem`, and rendered as a
  `TrustBadge` chip on the Query + History pages. Migration `b1c2d3e4f5a6` (additive, nullable — old
  rows show no badge).
- **Workspaces / RBAC:** `workspaces` + `workspace_members` (role viewer<editor<owner);
  `workspace_service.require_role` gates membership ops; the workspace owner can't be self-demoted.
- **Row-level security (RLS):** `rls_rules` (per-member allowed value on a datasource column).
  Primary enforcement is **SQL-level** — `rls_sql.constrain_sql` (sqlglot) AND-s a
  `CAST(tbl.col AS TEXT) IN (...)` predicate into each protected table's SELECT scope **before**
  aggregation, so SUM/GROUP BY can't leak filtered rows; case-insensitive table match, CTE-shadow
  aware, **fail-closed** if a protected table can't be constrained. Post-fetch `rls_service.apply`
  remains a fallback. Enforced in `query_service._live_pipeline` AND `reexecute_logged_query`
  (dashboard refresh); the live-broadcast path re-applies it too. A source can now be shared to a
  workspace (`workspace_resources`, query-only for members via
  `datasource_service.get_datasource_for_user`), and RLS is what makes that safe: the source stays
  owned by whoever shared it, while every read is constrained by the **viewer's** scope.
  **Deny-by-default:** `datasources.rls_mode` is `open` (a ruleless member sees everything —
  what pre-existing sources keep) or `strict` (a ruleless non-owner sees nothing, via
  `rls_sql.deny_all_sql`, which wraps the query so even an aggregate returns zero rows).
  New sources are created `strict`. `rls_service.resolve_scope` is the sentinel every read
  path goes through — it distinguishes "no rule" from "no restriction", which a bare rule
  list cannot. Owner-scoped fan-out paths (live broadcast, public share, embed) render one
  unfiltered dataset for a whole audience, so they ask `restricted_datasource_ids` instead:
  a share token names nobody and blanks any restricted source, while the live loop names the
  room's roster and so keeps ticking for an audience the lock never restricted. See SECURITY.md.
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
- **Realtime:** `realtime/hub` holds the WS rooms in process memory (collab cursors + chat), with
  `realtime/bus` bridging what must be true on every worker. **Eviction always crosses:** a room is
  authorised once at connect and never re-checked, so a removed member would keep receiving full
  message bodies on any worker that did not serve the DELETE. **Delivery and presence cross only
  when `REALTIME_BUS_ENABLED`** — off by default, since a single-worker deployment gains nothing and
  pays a Redis round trip per message. With it on, the subscriber performs *every* delivery
  (publishing *and* sending locally would double-deliver on the sender's worker), and presence is a
  sorted set scored by heartbeat, so a worker that dies takes its participants with it instead of
  leaving ghosts in the roster. `live_refresh`
  re-runs live dashboards' widget SQL (data-only) on an interval and pushes over the WS. When a
  dashboard has an active **global filter** it routes through `apply_global_filter(skip_rls=True)`
  so the live push stays filtered (and never fans an owner-scoped dataset out to restricted guests).
- **Global dashboard filter:** `dashboard_filter_sql.apply_filter` (sqlglot) AND-s a date range +
  dimension slicers into each widget's stored SQL **before** `_guarded_execute`, so the allowlist +
  per-viewer RLS still run on the filtered query. Mirrors `rls_sql` but **fail-open** (a widget whose
  query lacks the column is left unfiltered) and binds each column to one table (first owner) to avoid
  over-restricting joins. `PATCH /dashboard/{id}/filter` persists the spec (`dashboards.global_filter`)
  and returns each widget re-run with it — data-only, the stored snapshot is never mutated.
- **Decision Intelligence Loop:** `decisions` (insight→action→outcome + status) via `decision_service`,
  extended into a closed loop. A decision can bind to a metric (an NL query + optional column): the
  **baseline** is captured at create time (read from the spawning query's stored result, else one run),
  and the **realized** value is re-measured over time by **re-executing the bound query's stored SQL
  with no AI** (`query_service.reexecute_logged_query`), appending each point to `decision_measurements`.
  `_compute_impact_status` scores pending/on_track/achieved/missed/regressed vs the predicted
  value+direction; `accuracy_summary` reports direction-hit-rate **and** target-achievement separately
  (the calibration signal). The scheduler re-measures due decisions per cadence in an **isolated**
  per-decision try/except (one failure can't sink the batch; scheduled runs never fall back to paid AI).
  `extract_scalar` reduces a result set to one metric number. Endpoints: `/{id}/measure` (RateLimited),
  `/roi`, `/trajectory`, `/accuracy`.
- **RAG grounding:** a **portable vector store** (`query_embeddings` table, JSON float arrays + numpy
  cosine — no pgvector/Postgres dependency). `ai/client.embed` uses the real embedding model, or a
  **deterministic hash embedding** offline/keyless (CI-safe). `ai/retrieval.retrieve_context` scores a
  bounded, **user-scoped** candidate set (own queries + global verified metrics; mismatched embedding
  dims skipped) and returns a few-shot block for the Text2SQL prompt; `index_text`/`reindex` (one
  batched embed call) populate it. RLS-safe: a user never retrieves another user's examples.
- **Sharing / embed:** `dashboards.share_token` (public read-only snapshot, no auth) AND
  `dashboards.embed_enabled` + a signed embed token (`security.create_embed_token`, `emb` claim);
  `embed_service.resolve` re-checks `embed_enabled` so disabling instantly revokes all tokens.
  `GET /public/embed/{token}` serves the dashboard + the owner's white-label `brand_configs`
  (app_name/primary_color/logo_url, server-validated against injection). `public/embed.js`
  auto-mounts an iframe in third-party pages.
- **Billing / tiers:** `billing/tiers` is the single source of truth for quotas;
  `usage_service` enforces a monthly window by taking ONE unit up front in a single atomic
  `UPDATE … WHERE ai_calls_used + 1 <= quota` — check and consume in one statement, so concurrent
  questions can't race past the limit — and reconciling the rest of the request's real cost
  afterwards (see LLM cost control). `POST /upgrade` is a demo mock; `POST /checkout` is a
  config-gated real Stripe Checkout (no `STRIPE_SECRET_KEY` → refused).
- **LLM cost control:** every completion is capped (`AI_MAX_TOKENS_JSON|TEXT|TOOLS`) and priced
  from `AI_PRICE_*` into `ai_spend_daily` by `billing/cost.record`. Quota is charged in proportion
  to the real fan-out, not one unit per request: `ai/call_context` counts the calls a request
  actually made — a mutable object in the ContextVar, because `asyncio.gather` copies the context
  and a plain `ContextVar[int].set()` in a child task is invisible to the parent (`query_service`
  and `dashboard_service` both fan out that way, so a dashboard would have billed 1 instead of 19).
  `AI_DAILY_USD_CEILING` stops the day when the spend crosses it. **The ceiling is only reliable on
  Postgres** — on SQLite the request's own open transaction locks the database against the spend
  writer, so rows are dropped rather than waited on (`docs/deploy.md` says so out loud).
  Actual measured cost lives in `backend/scripts/measure_ai_cost.py`.
- **Chart export & print:** `lib/chartExport.ts` serializes a chart's live SVG, inlines a
  background, and rasterizes it — offered by `ChartExportMenu` on three surfaces (query view, chat
  share card, dashboard widget). Rasterization must keep the `data:` URL: prod CSP allows
  `img-src 'self' data:` and **not** `blob:`, so "modernizing" to `createObjectURL` would break
  only in production. Dashboard printing renders a separate off-screen `DashboardPrintView` rather
  than `@media print` alone, because react-grid-layout never reflows on screen and recharts'
  ResizeObserver therefore never fires.
- **Auth / refresh tokens:** register/login issue an **access + refresh pair** (`auth_token_service.issue_pair`).
  `POST /auth/refresh` rotates the refresh token (`rotate`, `SELECT ... FOR UPDATE`) and **detects reuse**
  — a replayed token revokes the whole family. `POST /auth/logout` revokes it. Access TTL is short
  (`ACCESS_TOKEN_EXPIRE_MINUTES`, default 30); refresh lives `REFRESH_TOKEN_EXPIRE_DAYS`. `get_current_user`
  rejects non-`sub` claims, so refresh/ws/embed tokens can't be used as access tokens. Frontend
  `tokenStore` does single-flight 401-refresh.
- **CI:** `.github/workflows/ci.yml` runs four jobs on push/PR: **backend** (ruff + pytest),
  **frontend** (Vitest + build), a **blocking `e2e`** job (`needs: backend, frontend`), and
  **deploy-smoke** (`docker-compose.prod.yml` + `scripts/deploy_smoke.sh`) — the only place the
  Docker layer is ever executed, since no container runtime exists on the dev machine. Two more
  workflows run alongside: `codeql.yml` (python + javascript-typescript) and `secret-scan.yml`
  (gitleaks over full history). The `main` ruleset requires five of them: Backend, Frontend,
  E2E smoke, gitleaks, Deploy smoke — CodeQL is excluded because its matrix job names vary.
  The e2e job boots a demo backend and runs the Playwright smoke. Because a GitHub Actions step
  kills its background processes on exit, the backend boot, `alembic upgrade head`, health-wait,
  and `npm run test:e2e` all live in ONE step.
- **Testing:** backend pytest (887, +1 skip) mocks the AI engine at the boundary — patch the **class**
  `query_service.Text2SQLEngine`, never the shared `_engine` singleton instance (an instance patch
  leaks an own attribute that shadows later class patches). The suite is **hermetic** — `conftest`
  sets `AI_API_KEY=""` so embeddings use the hash fallback and Text2SQL uses rule-based (offline,
  deterministic, no cost — identical to CI; new suites: test_snapshots, test_graph,
  test_ba, test_automl, test_ai_cost, test_usage_quota, test_rls_mode). Frontend Vitest (777) covers `lib/*`, hooks, and Zustand
  store reducers (`src/**/*.test.*`, incl. decision-measure, the advanced-analytics
  stores/panels — metric-tree/data-contract/Dropdown/color — and the studio round:
  twinStore/metricTreeMath/baStore/BCGMatrix/automlStore; e2e specs belong to
  Playwright). E2E: `frontend/e2e/smoke.spec.ts` over login → query → dashboards against the preview.
- **AI evaluation** (`backend/tests/golden/`, `test_eval_nl2sql.py`): 80 `(question,
  reference SQL, shape assertion)` triples — 40 questions mirrored in az and en — scored
  through the real `query_service._demo_pipeline` by **result-set equivalence**, never SQL
  string match (column names, column order and, unless the question asks for an order, row
  order are all free to vary; the values that share a row are not). Candidate and reference
  execute against ONE seeded snapshot, so the demo live-feed multipliers cannot make two runs
  disagree. Because `conftest` blanks `AI_API_KEY`, the run scores the deterministic
  fallback at zero cost inside the normal suite; the real model is opt-in
  (`NEXUSBI_EVAL_LLM=1`, ~$0.22) and reported, never gated. Measured 2026-08-02 and
  re-measured the same day after a golden case was replaced — unchanged,
  `nl2sql_exact@1`: fallback **0.50** overall (1.00 core — gated by a ratchet floor —
  and 0.00 full), gpt-4o **0.97** (1.00 core / 0.95 full), parity 0.97 in both languages.
  The pair is the point: **losing the model costs 0.97 → 0.50**, entirely in questions
  needing a join, a filter or a subquery — so the case for widening the offline engine
  is now arithmetic. Both numbers are **cold-start**: the harness passes the question
  without production's `prompt_context`, so RAG grounding is out of scope by design and
  a retrieval regression will not show here. CI publishes the table to the job summary and uploads
  `eval-report.json`; design and the rule for adding cases live in
  `docs/superpowers/specs/2026-08-02-nl2sql-eval-design.md`.
- **Observability:** `core/metrics` (Prometheus) exposes HTTP/AI/SQL counters plus
  `ai_latency_seconds` and `rag_retrievals_total` (hit/miss) at `/metrics`.
  Structured logs via structlog.

## Deployment

Two stacks, and the difference is deliberate. `docker-compose.yml` is development:
bind-mounted source, `--reload`, `DEMO_MODE=true`, no TLS. `docker-compose.prod.yml`
is a real installation. Operator instructions live in [deploy.md](deploy.md); the
design decisions are here.

- **One Dockerfile, two targets.** `backend/Dockerfile` builds dependencies into a
  venv in a throwaway stage, then branches: `dev` (root, no source — the compose
  bind mount supplies it) and `production` (non-root uid 10001, source baked in,
  no test runner, `HEALTHCHECK` on `/live`). Production is the *last* stage, so a
  bare `docker build` can never hand back the development image by accident.
- **Migrations run once, outside the app.** A one-shot `migrate` service holds
  `service_completed_successfully` over the backend. Putting them in the lifespan
  would run them in all four uvicorn workers simultaneously, racing on
  `alembic_version`; `db/migration_lock` adds a Postgres advisory lock for the
  cases compose does not cover (a k8s Job retry, a manual `alembic upgrade head`).
- **One origin.** Caddy serves the built SPA and reverse-proxies `/api`, `/ws`,
  `/live`, `/ready`, `/health` to the backend, which is what lets the frontend be
  built with a *relative* API base: one image works on any domain, and nothing is
  cross-origin so CORS never applies. `lib/wsUrl` resolves that relative base
  against `window.location` because the WebSocket constructor cannot take one.
  `/metrics` is deliberately not proxied — Prometheus reaches it on the internal
  network instead of the internet.
- **Caddy, not nginx**, for reasons specific to this app: ACME renewal lives in the
  process rather than a certbot timer that fails quietly at 90 days; `reverse_proxy`
  forwards WebSocket upgrades without the header boilerplate three realtime
  endpoints depend on; and it does not buffer streaming responses. No frame headers
  are set at the edge, unlike API responses — embedded dashboards are a feature, and
  `frame-ancestors 'none'` there would disable white-label embedding outright.
- **`REALTIME_BUS_ENABLED=true` in production**, since the stack is multi-worker by
  default; `TRUSTED_PROXY_HOPS=1` matches the single proxy in front.
- **The exit criterion is a CI job, not a claim.** `scripts/deploy_smoke.sh` stands
  the production stack up on empty volumes and asserts what it claims to be —
  non-demo, migrated before serving, unprivileged, one scheduler leader among four
  workers, data surviving a full restart, `/ready` 503 with `/live` 200 when the
  database dies. It runs as `Deploy smoke (docker compose)` on every PR.

## Data model (app DB)

`users` (1)─<(N)) `datasources`, `query_logs`, `dashboards`, `saved_queries`, `metrics`,
`alerts`, `notifications`, `decisions`, **`requirement_docs`, `kpi_targets`,
`integration_channels`, `workspaces`, `workspace_members`, `rls_rules`, `audit_logs`,
`brand_configs` (1:1), `refresh_tokens`, `query_embeddings`,
**`metric_nodes` (self-FK tree; a leaf is either `source_kind='manual'` with a hand-typed
`manual_value`, or `source_kind='query'` bound to `saved_query_id` + `value_column` + `agg` —
`ON DELETE SET NULL`, so deleting the query leaves the KPI node alive and merely unmeasurable),
`data_contracts`**,
**`ba_artifacts`, `ml_models`**; `dashboards`
(1)─<(N) `widgets`, `dashboard_comments` and **`dashboard_snapshots`**; `data_contracts` (1)─<(N) `contract_runs`;
`decisions` (1)─<(N) `decision_measurements`; `alerts` → `saved_queries`; `widgets.query_log_id`
→ `query_logs`; `rls_rules` → `datasources` (+ owner/member → `users`); `workspace_members` →
`workspaces`; `query_logs.datasource_id` / `metrics.datasource_id` / `saved_queries.datasource_id`
→ `datasources`. (`decisions` also link `datasource_id` + `last_query_log_id`/`query_log_id`.)

Latest schema changes: **`f8a9b0c1d2e3`** — Decision Intelligence Loop (`decisions` metric-binding
columns + the `decision_measurements` table); **`a9b0c1d2e3f4`** — AI engineering (`query_embeddings`
RAG vector store + `eval_runs`); **`b0c1d2e3f4a5`** — `eval_runs.details` (per-case breakdown);
**`c1d2e3f4a5b6`** — `eval_runs.mode` (bare/grounded/history); **`d2e3f4a5b6c7`** —
`notifications.category`. Advanced-analytics round (6 features): **`e3f4a5b6c7d8`** (`experiments`),
**`f4a5b6c7d8e9`** (`insights`), **`a5b6c7d8e9f0`** (`metric_nodes`), **`b6c7d8e9f0a1`**
(`data_contracts` + `contract_runs`). Studio round: **`e9f0a1b2c3d4`** (`dashboard_snapshots` —
Time Machine), **`f0a1b2c3d4e5`** (`ba_artifacts` — BA Framework Studio), **`a2b3c4d5e6f7`**
(`ml_models` — AutoML). Later rounds: **`b3c4d5e6f7a8`** (`alerts.condition_type` — anomaly
alerts), **`c4d5e6f7a8b9`** (drop `insights` — dedup cleanup), **`d5e6f7a8b9c0`**
(`dashboards.global_filter` — server-side global dashboard filter), **`e6f7a8b9c0d1`**
(`ml_models.leaderboard` + `.diagnostics` — AutoML k-fold CV / confusion / actual-vs-predicted /
permutation importance / per-prediction explain stats). De-bloat + trust round: **`f7a8b9c0d1e2`**
(drop `experiments`), **`a8b9c0d1e2f3`** (drop `eval_runs`), **`b1c2d3e4f5a6`** (`query_logs.confidence`
+ `.provenance` — answer Trust Badge), **`d7e8f9a0b1c2`** (`metric_nodes` provenance — the
`source_kind`/`saved_query_id`/`value_column`/`agg` binding that lets a KPI leaf be measured instead
of typed; `server_default='manual'` is spelled identically in the model and the migration so
`check_schema_drift.py` stays at its baseline). Migrations are Alembic, chained under `db/migrations/versions`;
head at the time of writing = **`f9a0b1c2d3e4`** (`decision_measurements.data_as_of`), reached via
`a4b5c6d7e8f9` (`ba_artifacts.datasource_id`) → … → `d7e8f9a0b1c2` → `e8f9a0b1c2d3`.
⚠️ **Do not trust that id — ask the tree.** This line said `a4b5c6d7e8f9` for **eight** revisions
after it stopped being the head (`f1a2b3c4d5e6` → `f3a4b5c6d7e8` → `a0b1c2d3e4f5` → `b5c6d7e8f9a0`
→ `c6d7e8f9a0b1` → `d7e8f9a0b1c2` → `e8f9a0b1c2d3` → `f9a0b1c2d3e4`, 2026-07-30 … 08-05), which is
how fast this particular line rots — the audit note that opened this branch said "three" and was
itself stale. It is the exact drift `core/health.py:37` refuses to allow: it reads
the head from `ScriptDirectory.get_heads()` "rather than a constant, so the expectation" tracks the
migrations. `alembic heads` (or that call) is the answer; this paragraph is orientation, not truth.
`/ready` compares the database's applied revision against the head and answers 503 when they
disagree, so "booted but unmigrated" is reported rather than surfacing as 500s. NOTE: the **demo**
schema is seeded in-memory
(`db/demo_data._seed`, no migration) — `sales.customer_id` was added there to enable realistic
customer↔sales joins, and an `events` table (visit→signup→trial→purchase) is retained (the dedicated
cohort/funnel feature was later removed in `d23cdb2`; the events table now only backs NL "funnel"-style
queries); `format_demo_schema` sends real column types + sample values to the prompt.

## Notable architecture deltas (this round)

- **Metric-tree provenance (`d7e8f9a0b1c2`).** A leaf used to be a hand-typed float that nothing
  downstream could distinguish from a measurement: `evaluate_metric_tree` handed the copilot
  `{name, value, leaves}` with the origin stripped while `SYSTEM_PROMPT` told the model to trust
  whatever a tool returned, and the same floats fed the entire Digital Twin (hero, waterfall,
  tornado, Monte Carlo, goal seek, narrative prose). A leaf now declares itself **measured**
  (aggregated from a saved query's last STORED run via `sum/avg/min/max/last/count`, carrying the
  query name and run time), **manual** (an assumption, labelled as one), or **unknown**.
  - *Unknown propagates.* `_combine` returns `None` if any input is `None`, so an ancestor of an
    empty leaf has no value rather than one computed from a guess. Reading an empty leaf as 0
    merely understates an `add` total but **zeroes a `mul` KPI outright**, and both rendered as
    confident numbers. `lib/metricTreeMath.ts` mirrors the semantics exactly, including the
    nullish check (`== null`, because JS has two nullish values and NaN would pass `isComplete`).
  - *The read path executes nothing.* `evaluate()` runs on every copilot turn and every Twin load,
    so a measured leaf reads rows already stored on the query's last run — the same source
    `alert_service` evaluates against. The number can therefore be stale, which is why
    `measured_at` travels with it; its bound (a cache hit can make the rows older than the stamp)
    is documented at the point of use.
  - *Refusal over invention.* `GET /metric-tree/bindable` lists bindable queries with their last
    run's columns (JSON-member select, so a dropdown does not deserialise 1000-row snapshots), and
    a KPI with an unknown leaf makes every what-if surface refuse and name the empty leaves instead.
    Removing that gate does not compile — `TwinKpiHero` requires a number.

- **Studio round (originally 6 features; the cohort/funnel item was later removed in `d23cdb2`,
  leaving 5 live).** (1) **Time Machine** — `DashboardSnapshot` (migration
  `e9f0a1b2c3d4`) + `snapshot_service` (capture caps ≤200 rows/widget, 50-snapshot retention;
  the scheduler adds an hourly scheduled capture for live dashboards);
  `POST/GET /dashboard/{id}/snapshots`, `GET/DELETE .../snapshots/{sid}`; FE toggle + snapshot
  timeline + diff badges (`lib/snapshotDiff`). (2) **Knowledge graph** — `graph_service.build`
  assembles namespaced nodes (table/metric/mnode/dash/widget/squery/decision/ds/column) reusing the
  lineage parser, with a trust overlay (metric `verified` + datasource freshness SLA) and FK
  `references` edges from `schema_cache`; `GET /graph` (opt `?columns=`), read-only + deterministic.
  **User-curated Graph Views** sit on top: `graph_view_service` + `GraphView` model (migration
  `f5a6b7c8d9e0`; `included`/`hidden_node`/`hidden_edge` id-sets as JSON) with
  `GET/POST/PATCH/DELETE /graph/views` — the FE derives every subgraph locally from the single
  `/graph` payload (`viewGraph` pure helper), so there's no per-view backend compute. FE `/graph` is
  a hand-rolled SVG force layout: 4-direction impact/path BFS highlight, right-click remove-from-view
  + create-graph / add-assets modals (full-graph removals persist to localStorage, named views PATCH
  the backend), drag-pin, mini-map, PNG/SVG export; the toolbar collapses secondary controls into one
  options menu (`ActionMenu` + count badge). (3) **Digital Twin** — frontend-ONLY `/twin`, a **3-surface simulator
  (Model · Simulyator · Risk)**. `lib/metricTreeMath.ts` is an exact port of the backend metric-tree
  `_combine` semantics. **Model** = metric-tree editor; **Simulyator** = KPI hero (sparkline + optional
  P10–P90 uncertainty band), leaf ±% sliders, cumulative waterfall, ±10% tornado, goal-seek, scenario
  compare, KPI-target pacing badge, and a "what changed" ranked-driver narrative (`lib/twinNarrative.ts`);
  **Risk** = 2000-iteration Monte Carlo over per-lever ranges → P10/P50/P90 + histogram
  (`lib/twinAnalysis.ts`, animated `components/twin/chartkit.tsx`). Scenarios persist via zustand
  (`nexusbi-twin`, scenarios only). No backend change. (4) **BA Framework Studio** —
  `ai/ba_frameworks.py` (SWOT/Porter/BCG/BPMN; AI-first with deterministic fallbacks; the BCG
  core is deterministic over a single demo snapshot — share = revenue share, growth = H2-vs-H1,
  AI only advises; BPMN mermaid passes a server-side **fail-closed sanitizer**); `BAArtifact`
  (migration `f0a1b2c3d4e5`); `POST /ba/generate` (AI quota) + `GET /ba` + `GET/DELETE /ba/{id}`;
  shared `ai/textparse.py`. FE `/ba-studio` (SWOTGrid 2×2, PorterForces, BCGMatrix SVG,
  MermaidDiagram as a lazy ~1MB chunk, `securityLevel: strict`). (5) **AutoML Studio** —
  `scikit-learn==1.6.1`; `MLModel` (migration `a2b3c4d5e6f7`; `leaderboard`+`diagnostics` JSON added
  in `e6f7a8b9c0d1`; the pickle blob is only ever the server's own estimator and never appears in
  any response); `automl_service` (Linear/LogReg vs RandomForest holdout selection, sklearn imports
  kept function-local, fit + diagnostics in `asyncio.to_thread`, ≤5000 training rows, blob ≤5MB).
  `_build_diagnostics` adds a candidate **leaderboard**, **k-fold CV** of the winner (shuffled,
  NaN-sanitized so JSON.parse never chokes), a **confusion matrix** (numeric-aware label order) or
  **actual-vs-predicted** points (≤200), **permutation importance**, and capped per-feature stats
  for **per-prediction explanations** that name the original column (not the one-hot dummy);
  `GET /automl/tables`, `POST /automl/train` (per-IP 5/min), `GET /automl/models`,
  `POST /automl/models/{id}/predict` → `{predictions, explanations}` (per-IP 30/min),
  `DELETE /automl/models/{id}`; FE `/automl` wizard with diagnostics visuals (Recharts + heat-grid).
- **Guard-chain reuse, again:** the AutoML datasource path runs through the SAME
  `query_service._guarded_execute` chain as `/query` (table allowlist → per-viewer RLS →
  pooled execute) — training data can't see rows the viewer couldn't query.
- **`NexusBIException` now carries an optional machine-readable `code`** — the 429 quota error
  sets `code="ai_quota"`, and the client redirects to `/pricing` ONLY on that code (other 429s,
  e.g. per-IP train/predict limits, no longer mis-route).
- **Mermaid is rendered fail-closed:** BPMN diagram text is sanitized server-side (dangerous
  directives/HTML rejected, not stripped-and-hoped) and the FE renders with mermaid
  `securityLevel: strict` in an isolated lazy chunk.
- **BA-magnet features (4).** (1) **Pivot explorer** — pure client-side (`lib/pivot.ts` +
  `PivotWidget`), slots into the ChartView type switcher; no backend. (2) **Global semantic
  search** — reuses the `query_embeddings` vector store + `client.embed` cosine via a parallel
  `ai/search.py` (new asset kinds + `ref_id` column; upsert with orphan/dup prune; keyless
  hash fallback); `GET /search` (per-IP rate-limited) + `POST /search/reindex`; ⌘K palette in
  `TopBar`/`Layout`. (3) **Scheduled PDF/Excel report delivery** — `ReportSubscription` model +
  `report_renderer` (openpyxl/reportlab) + `report_delivery_service.run_deliveries_due` as a
  4th scheduler phase (cadence stamped up-front so a failing subscription retries at most once
  per interval, never per tick); `integrations.deliver_report` adds attachment support
  (`INTEGRATIONS_LIVE`-gated). (4) **MySQL connector fix** — added the missing `aiomysql` async
  driver (enum/timeout/dialect were already MySQL-ready) + UI option.
- **SQL power-user path + guard-chain consolidation.** New AI-free `POST /query/run`
  (`run_user_sql`) lets analysts run/edit raw SQL. The allowlist+RLS+execute sequence that was
  copy-pasted across `_live_pipeline` and `reexecute_logged_query` is now a single
  `query_service._guarded_execute` helper reused by all three callers (no security drift). Manual
  runs are DEMO_MODE-gated for the no-datasource case, demo execution is row-capped (`fetchmany`),
  and history rows are marked with a `[SQL]` label (no migration). Frontend: CodeMirror 6 lazy chunk
  (`SQLEditor`→`SQLEditorInner`, schema-aware autocomplete) — kept out of the initial route bundle
  like recharts; `lib/sqlLabel.ts` centralizes the marker.
- **Chart colour accessibility (`charts/theme.ts`, `lib/color.ts`, four rounds).** Chart colours are
  hex, not CSS tokens, and the reason is `lib/chartExport.ts`: image export serialises the live
  `<svg>` into a standalone document, which has no `:root` to resolve `var()` against, so a
  token-coloured mark loses its colour in the exported PNG. Hex travels. That constraint is why the
  palette needs its own guard instead of inheriting the app's.
  **What each round found, since the order is the useful part** — six PRs, six rounds: (1) value
  labels were painted in palette colours, which are picked against the 3:1 *graphics* floor and not
  the 4.5:1 text one, so they moved to ink (#30). (2) The same mistake one element over: axis tick
  text and titles sat on `AXIS` — labels moved to `INK_SOFT`, the axis *line* stayed on `AXIS`
  because a line is graphics, so nothing changed visually (#32). (3) The whole palette was tuned
  on the dark canvas: measured against the light surfaces **15 of 20 colours** fell under WCAG
  1.4.11, so the palette split per mode (#33). (4) The real defect was none of those — under
  simulated dichromacy the closest pair measured **ΔE 2.2 dark / 5.2 light**, invisible to every
  check the repo had (#35). ⚠️ Separating the colliding hues does nothing: dichromacy deletes an
  opponent axis rather than dulling it, so the palette was respread by lightness with hues kept.
  (5) The trust ring told severity by hue alone, and dimmed itself below the floor while doing it —
  each severity got a `stroke-dasharray` plus a tooltip word, and dimming moved from opacity to
  **width** (2.5 → 1.5px), because measured, *no* opacity below `RING_OPACITY` clears 3:1 (#37).
  (6) The instrument itself was wrong: the simulator was Viénot's single plane and the metric was
  CIE76. Fixing both did not improve the palette — it **revealed** it: tritan gamut clipping went
  from six colours to zero, so every tritan figure the repo had ever quoted was partly a
  measurement of a silent clamp (#38).
  **The guard** (`theme.test.ts`) scores every pair a chart can place side by side — six series plus
  the folded-"other" `INK_FAINT` pie wedge, which is why `PieChartWidget.TOP_N` is derived from
  `SERIES_COUNT` rather than chosen — in normal vision and under all three dichromacies, plus 3:1
  against every surface. `simulateDichromacy` is **Brettel, Viénot & Mollon (1997)** — two
  half-planes hinged on the neutral axis, not the 1999 single plane, whose own text limits that
  simplification to protan and deutan. Each condition is anchored by a pair built on **its own
  confusion line** (scale only the missing cone in LMS), so replacing any one matrix with the
  identity fails a named test. That anchoring exists because it did not at first: with only a
  deuteranopia anchor, the protan and tritan matrices could both be identity and the suite stayed
  green. The 27 transcribed constants are held by four structural properties in `lib/color.test.ts`
  (row sums, `P·P = P`, hinge agreement, and that both halves are actually selected between), plus
  one pinned output per half — the rule-based check alone is blind to swapping `m1`/`m2` in the
  table. The metric is **CIEDE2000**, validated against all 34 published Sharma/Wu/Dalal pairs in
  `lib/ciede2000.sharma.test.ts`; CIE76 was deleted rather than kept, since after the switch its
  only remaining callers were its own two assertions.
  **Both palettes were then re-picked against those instruments, and both floors are now met.** The
  `DEBT` table that named 14 of the 40 scored pairs as under ΔE00 10 (worst light
  `SERIES[4]`/`INK_FAINT` at 3.24 under tritanopia, dark `SERIES[4]`/`SERIES[5]` at 3.99) is
  **empty**, and empty is asserted rather than absent: the set-equality check reads "no pair is under
  the floor", which can fail. The floor was **not** lowered — 10 is the digit it was when fourteen
  pairs failed it. `SERIES[1..5]` moved in both modes; `SERIES[0]` is frozen to `--accent` and
  `INK_FAINT` is untouched, both being app-wide tokens. The colours were chosen by **minimising the
  largest per-slot move** from the previous set subject to every floor, not by maximising separation
  — that objective pushes an optimiser to the ends of the lightness axis and returns a set nobody
  would recognise as this product. What the shipped sets achieve is pinned as `MARGIN` by name, value
  and worst reader: closest pair **12.21** (light `SERIES[0]`/`[1]`, protanopia) and **13.58** (dark,
  same pair) — because `>=` cannot tell 12.21 from 40, and emptying `DEBT` would otherwise have
  deleted every pinned ΔE00 in the file.
  **Greyscale is now covered too, by a second floor with its own assertion.** Every dichromacy model
  preserves lightness, so nothing in the ΔE00 loop can see two colours that photocopy to the same
  grey — the previous set had a pair at **ΔL\* 0.4** that scored 28.93 under deuteranopia and passed
  everything. That pair is the new test's **positive control**: it must fail the ΔL\* floor while
  passing the ΔE00 one, so the guard proves it reaches a reader the other cannot. Worst ΔL\* is now
  **5.05** (light) and **5.51** (dark) against a floor asserted at **4.5** — not the 5 the ticket
  aimed at, because the search shows half a point more margin costs a shift of ΔE00 29.2, i.e. a
  different palette rather than this one adjusted, and asserting 5 against a measured 5.05 would be a
  tripwire rather than a requirement. Both floors score the same population through one helper and
  both assert its size, so they cannot drift onto different pairs.
  ⚠️ The pre-Brettel figures this section used to quote (5.37/5.34, and "6 of the 12 series colours
  gamut-clipped under tritan") were partly measurements of a silent clamp: under the two-half-plane
  model **nothing in the palette clips**, so the test asserts an empty table alongside a positive
  control (`#FFFF00`, `#00FFFF`, which still do clip) — an empty-set assertion cannot fail on its
  own. `GRAPH_TYPE_COLORS` is excluded on purpose: node type is carried by a per-type icon plus its
  name in words, so extending the loop there would report failures that are not defects.
  `HEALTH_COLOR` is scored separately, because what it must satisfy is a different sentence —
  severity has to be separable by *something*, and the `stroke-dasharray` per severity satisfies it
  where hue does not: `warn` vs `danger` is **ΔE00 4.50** in light under deuteranopia, composited as
  painted, still under the floor. Dimming a ring is a **width** change (2.5 → 1.5), not the
  `opacity 0.4` that once put it at 1.64–2.40:1; no opacity below `RING_OPACITY` clears 3:1.
- **Advanced-analytics subsystem (5 features, deterministic stats — scipy added).**
  `services/stats.py` is the shared statistical core (Welch t-test + Cohen's d, two-proportion
  z-test, Pearson, Benjamini-Hochberg FDR, MAD outliers, summary-stats t-test); `services/tabular.py`
  holds the shared numeric-column/row-alignment helpers. Built on it: **statistical guard** (`ai/stats_guard`
  + `POST /query/{id}/significance`), **causal driver analysis** (`services/causal` + `/causal`),
  **metric tree** (`metric_tree_service`
  bottom-up roll-up with per-leaf provenance, recursive subtree delete since SQLite cascade is
  inert), and **data contracts**
  (`data_contract_service` reuses `profiling_service` for safe sample-based checks + schema-hash drift +
  freshness; fail-CLOSED on unknown rules). Per-query analytics surface as lazy ChartView panels;
  the rest as their own pages (Planlama/Analiz/Məlumat sidebar groups).
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
- **Lazy chart bundle:** `ChartRenderer` (which transitively imports recharts, **~419 kB**
  uncompressed as of the current build, in the decimal kB `vite build` prints: `axis-*` 349.7 +
  `ChartRenderer-*` 47.2 + `Area-*` 21.5 + `ScatterChart-*` 0.6 + `ComposedChart-*` 0.3 — quote one
  unit or the other, the earlier "~410kB" was that same byte count in KiB with a kB label) is loaded
  through `charts/LazyChartRenderer` — a `lazy(() => import('./ChartRenderer'))` wrapped in its own
  Suspense/`ChartSkeleton`. **All eight** render sites import the wrapper (`ChartView`,
  `ScenarioPanel`, `ShareChartModal`, `DashboardGrid`, `DashboardPrintView`, `PublicWidgetGrid`,
  `SnapshotView`, `StoryMode`), so recharts is no longer in the initial `/` chunk; it arrives on
  first chart paint. ⚠️ **There is no `manualChunks.charts`, and adding one is the wrong move** —
  this line claimed it for a long time. `vite.config.ts` pins only `react` and says why in a
  comment: naming a vendor there links it into the entry's static graph, Vite emits a boot-time
  `modulepreload` for it, and that defeats the `lazy()` wrapper (it pulled ~261 kB gzip onto every
  page load, login included). Left alone, Rollup names the chunk itself — that is where `axis-*`
  comes from. `rollup-plugin-visualizer` (env-gated, `npm run analyze`) emits a treemap.
- **Test depth + blocking E2E:** Vitest grew to 65 *at the time of this round* (777 today — see the
  Testing bullet above; this line is a snapshot of that round, not a current count) (lib / hooks / store reducers, incl. the
  collab epoch-guard via a fake `WebSocket`); a blocking Playwright `e2e` CI job runs the
  login→query→dashboards smoke against a demo backend. Two CI-specific fixes underpin it: AI mocks
  patch the `Text2SQLEngine` **class** (not the `_engine` singleton, whose instance patch leaked),
  and the e2e job runs `alembic upgrade head` + backend boot + smoke in a single step (background
  processes don't survive a step boundary).
- **Closed-loop decisions:** a decision binds to a metric and is re-measured via the existing
  AI-free `reexecute_logged_query` path (the same one live dashboards use), with the scheduler
  isolating each decision so one failure can't wedge the batch. `accuracy_summary` keeps
  *direction-hit* and *target-achieved* as distinct signals (the UI labels them separately).
- **RAG without a new dependency:** the vector store is a JSON column + numpy cosine (portable to
  SQLite/CI), not pgvector. RAG context is applied to the **generation prompt only** — the result
  cache key stays on the stable `extra_context`, so index-on-write never busts a repeat-question
  hit. `client.embed` degrades to a deterministic hash embedding when keyless.
- **Hermetic tests:** `conftest` now sets `AI_API_KEY=""`, so the whole suite runs offline
  (embeddings → hash, Text2SQL → rule-based) — identical to CI, no network/cost, deterministic.

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
- **RAG retrieval is user-scoped** (RLS-safe): the candidate query filters to the requester's own
  embeddings plus global verified metrics, so prior queries never leak across users. The eval and
  reindex endpoints (real AI work) are **RateLimited** to bound spend + table growth.
- JWT on protected endpoints; Fernet-encrypted secrets (connection strings + integration
  targets); prod fails fast without strong `SECRET_KEY`/`FERNET_KEY`. Secrets never returned
  to clients. A final cross-cutting pentest pass confirmed the new surface; findings fixed.

## Conventions / decisions

- Async end-to-end (SQLAlchemy async, httpx, AI-engine async client).
- Services hold logic; routers stay thin. New domain → model + schema + service +
  router, registered in `api/v1/router.py` and `models/__init__.py`, with an Alembic
  migration.
- Graceful degradation over hard dependency (Redis, scheduler, Google all optional). Redis is
  still not required to *serve* — every cache call no-ops and `/ready` does not gate on it — but it
  is what makes multi-worker correct: it holds the scheduler lease and the shared rate-limit
  buckets. Where losing it would change an answer rather than slow one down, the code stands down
  loudly instead of guessing.
- Frontend theming via CSS-variable tokens (light/dark) consumed by Tailwind;
  emerald accent, Source Serif 4 display. State in small Zustand stores per domain.
