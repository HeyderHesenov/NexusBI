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
                            query_embeddings, eval_runs
```

## Backend layout (`backend/app`)

| Layer | Path | Responsibility |
|-------|------|----------------|
| API | `api/v1/*` | Thin routers: auth, query, datasource, dataprep, dashboard, **snapshot**, metric, saved_query, billing, branding, decision, integration, copilot, requirement, **ba**, **automl**, scenario, workspace, **cohort**, **graph**, **ai_quality (eval/observability/reindex)**, public, ws |
| Schemas | `schemas/*` | Pydantic request/response contracts |
| Services | `services/*` | Business logic: query_service, datasource_service, dashboard_service, metric_service, saved_query_service, scheduler, alert_service, insight_service, decision_service, cache_service, upload_service, billing/usage_service, digest_service, requirement_service, data_prep_service, profiling_service, lineage_service, workspace_service, rls_service, **rls_sql (SQL-level RLS), auth_token_service (refresh rotation)**, audit_service, scenario_service, kpi_target_service, integration_service, integrations, embed_service, brand_service, powerbi/*, **report_renderer (PDF/Excel), report_delivery_service**, **cohort_service, snapshot_service, graph_service, ba_service, automl_service** |
| AI | `ai/*` | text2sql, text2dax, chart_selector, insight_generator, insight_digest, analysis (forecast/anomaly/explain), root_cause, requirements, data_prep, dashboard_planner, data_story, copilot, **retrieval (RAG vector grounding), eval/* (tiered golden set, value-based execution-match, bare/grounded/history runner + regression)**, sql_guard, schema_introspector, rule_based_sql/dax, prompt_templates, **search (global asset semantic search)**, **ba_frameworks (SWOT/Porter/BCG/BPMN + mermaid sanitizer), textparse (shared AI-text parsing)**, **client (chat + embed + rolling AI trace)** |
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
and the run persists a `QueryLog` (label `✎ …` in `natural_language`; no migration) so history,
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
- **Agentic copilot (universal executor):** `ai/copilot` is a bounded tool-calling loop
  (`COPILOT_MAX_STEPS`) with a **29-tool registry that drives every product feature**: discovery
  tools (`search_assets` + `list_*` so the model finds ids instead of inventing them), queries/
  dashboards, AutoML train+predict, BA Studio generate, cohort funnel/retention, snapshots,
  A/B create+analyze, decisions create/measure, insight scan, data-contract run, metric-tree
  evaluate + twin `simulate` (single backend home: `metric_tree_service.simulate`), alerts.
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
- **AI eval & observability (operator/dev tool — the "AI Quality" page, removed from the analyst's
  sidebar; reachable only at `/ai-quality`):** `ai/eval` scores a difficulty-tiered golden set
  (easy/medium/hard: joins, HAVING, subqueries, ranking, percentage) by **value-based execution-match**
  (`runner._denotation` — compares result VALUES, column-name-agnostic, so an equivalent query with a
  different alias still passes; multi-gold `alt_sqls` for questions with >1 correct form). Three modes
  on `eval_runs.mode`: **bare** (engine only), **grounded** (engine + metric context + RAG — the
  bare→grounded delta quantifies RAG's value), and **history** (`ai/eval/regression` re-checks the
  user's OWN saved-query/dashboard questions for **AI drift**: regenerate the NL, then run the new vs
  the stored SQL on ONE seeded snapshot via `demo_data.execute_demo_snapshot` so the live-demo feed
  can't fake drift; a stored SQL that no longer runs is skipped, not counted). `runner.maybe_alert`
  raises a Notification (+ workflow dispatch, dedup'd against unread) when accuracy drops below
  `EVAL_ALERT_THRESHOLD`. **CI gate:** `test_rule_based_eval_floor` runs the deterministic keyless
  rule-based engine and asserts ≥ `EVAL_RULE_BASED_FLOOR`, plus `test_golden_set_health` (no empty-set
  gold). `client` keeps a bounded in-process **AI trace** → `observability()`. Prometheus
  (`text2sql_eval_accuracy`, `ai_latency_seconds`, `rag_retrievals_total`). Grounded eval / history
  regression open one session **per case** (concurrent `gather`; an AsyncSession isn't concurrency-safe)
  and offload demo seeding to `asyncio.to_thread`. `/ai/eval/run` (`?grounded`) +
  `/ai/eval/history-regression` + `/ai/retrieval/reindex` are RateLimited; `/ai/eval/runs` +
  `/ai/observability` are reads. The eval measures a TOY demo schema — labelled honestly in the UI as a
  regression signal, not a real-world accuracy claim.
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
- **CI:** `.github/workflows/ci.yml` runs three jobs on push/PR: **backend** (ruff + pytest),
  **frontend** (Vitest + build), and a **blocking `e2e`** job (`needs: backend, frontend`). The e2e
  job boots a demo backend and runs the Playwright smoke. Because a GitHub Actions step kills its
  background processes on exit, the backend boot, `alembic upgrade head`, health-wait, and
  `npm run test:e2e` all live in ONE step.
- **Testing:** backend pytest (420) mocks the AI engine at the boundary — patch the **class**
  `query_service.Text2SQLEngine`, never the shared `_engine` singleton instance (an instance patch
  leaks an own attribute that shadows later class patches). The suite is **hermetic** — `conftest`
  sets `AI_API_KEY=""` so embeddings use the hash fallback and Text2SQL uses rule-based (offline,
  deterministic, no cost — identical to CI; new suites: test_cohort, test_snapshots, test_graph,
  test_ba, test_automl). Frontend Vitest (202) covers `lib/*`, hooks, and Zustand
  store reducers (`src/**/*.test.*`, incl. decision-measure, AI-quality eval, the advanced-analytics
  stores/panels — experiment/insight/metric-tree/data-contract/Dropdown/color — and the studio round:
  twinStore/metricTreeMath/baStore/BCGMatrix/automlStore; e2e specs belong to
  Playwright). E2E: `frontend/e2e/smoke.spec.ts` over login → query → dashboards against the preview.
- **Observability:** `core/metrics` (Prometheus) exposes HTTP/AI/SQL counters plus
  `ai_latency_seconds`, `rag_retrievals_total` (hit/miss), and the `text2sql_eval_accuracy` gauge at
  `/metrics`; `client` also keeps a bounded in-process AI-call trace for the AI Quality view.
  Structured logs via structlog.

## Data model (app DB)

`users` (1)─<(N)) `datasources`, `query_logs`, `dashboards`, `saved_queries`, `metrics`,
`alerts`, `notifications`, `decisions`, **`requirement_docs`, `kpi_targets`,
`integration_channels`, `workspaces`, `workspace_members`, `rls_rules`, `audit_logs`,
`brand_configs` (1:1), `refresh_tokens`, `query_embeddings`, `eval_runs` (global, no FK),
**`experiments`, `insights`, `metric_nodes` (self-FK tree), `data_contracts`**,
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
(`dashboards.global_filter` — server-side global dashboard filter). Migrations are Alembic, chained
under `db/migrations/versions`; current head = **`d5e6f7a8b9c0`**. NOTE: the **demo** schema is seeded
in-memory (`db/demo_data._seed`, no migration) — `sales.customer_id` was added there to enable realistic
customer↔sales joins, and an `events` table (visit→signup→trial→purchase) was added for
cohort/funnel analytics; `format_demo_schema` sends real column types + sample values to the prompt.

## Notable architecture deltas (this round)

- **Studio round (6 features).** (1) **Cohort & funnel** — `cohort_service` computes weekly
  retention + a visit→signup→trial→purchase funnel with deterministic SQL over the demo `events`
  table; `GET /cohort/retention` + `/funnel`; FE `/cohort` renders hand-rolled SVG
  (CohortHeatmap + FunnelChart). (2) **Time Machine** — `DashboardSnapshot` (migration
  `e9f0a1b2c3d4`) + `snapshot_service` (capture caps ≤200 rows/widget, 50-snapshot retention;
  the scheduler adds an hourly scheduled capture for live dashboards);
  `POST/GET /dashboard/{id}/snapshots`, `GET/DELETE .../snapshots/{sid}`; FE toggle + snapshot
  timeline + diff badges (`lib/snapshotDiff`). (3) **Knowledge graph** — `graph_service.build`
  assembles namespaced nodes (table/metric/mnode/dash/widget/squery/decision/ds) reusing the
  lineage parser; `GET /graph`; FE `/graph` is a hand-rolled SVG force layout with an
  impact-mode BFS highlight. (4) **Digital Twin** — frontend-ONLY `/twin`:
  `lib/metricTreeMath.ts` is an exact port of the backend metric-tree `_combine` semantics;
  leaf ±% sliders, cumulative-sequential waterfall, ±10% tornado sensitivity; scenarios persist
  via zustand (`nexusbi-twin`, scenarios only). No backend change. (5) **BA Framework Studio** —
  `ai/ba_frameworks.py` (SWOT/Porter/BCG/BPMN; AI-first with deterministic fallbacks; the BCG
  core is deterministic over a single demo snapshot — share = revenue share, growth = H2-vs-H1,
  AI only advises; BPMN mermaid passes a server-side **fail-closed sanitizer**); `BAArtifact`
  (migration `f0a1b2c3d4e5`); `POST /ba/generate` (AI quota) + `GET /ba` + `GET/DELETE /ba/{id}`;
  shared `ai/textparse.py`. FE `/ba-studio` (SWOTGrid 2×2, PorterForces, BCGMatrix SVG,
  MermaidDiagram as a lazy ~1MB chunk, `securityLevel: strict`). (6) **AutoML Studio** —
  `scikit-learn==1.6.1`; `MLModel` (migration `a2b3c4d5e6f7` = new head; the pickle blob is only
  ever the server's own estimator and never appears in any response); `automl_service`
  (Linear/LogReg vs RandomForest holdout selection, sklearn imports kept function-local, fit in
  `asyncio.to_thread`, ≤5000 training rows, blob ≤5MB); `GET /automl/tables`,
  `POST /automl/train` (per-IP 5/min), `GET /automl/models`, `POST /automl/models/{id}/predict`
  (per-IP 30/min), `DELETE /automl/models/{id}`; FE `/automl` wizard.
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
  and history rows are marked with a `✎` label (no migration). Frontend: CodeMirror 6 lazy chunk
  (`SQLEditor`→`SQLEditorInner`, schema-aware autocomplete) — kept out of the initial route bundle
  like recharts; `lib/sqlLabel.ts` centralizes the marker.
- **Advanced-analytics subsystem (6 features, deterministic stats — scipy added).**
  `services/stats.py` is the shared statistical core (Welch t-test + Cohen's d, two-proportion
  z-test, Pearson, Benjamini-Hochberg FDR, MAD outliers, summary-stats t-test); `services/tabular.py`
  holds the shared numeric-column/row-alignment helpers. Built on it: **statistical guard** (`ai/stats_guard`
  + `POST /query/{id}/significance`), **causal driver analysis** (`services/causal` + `/causal`),
  **A/B testing** (`ab_service`, `experiments`), **insight engine** (`insight_engine.scan` — discovery +
  impact ranking + idempotent dedup, reuses `scan_recent_distinct`), **metric tree** (`metric_tree_service`
  bottom-up roll-up, recursive subtree delete since SQLite cascade is inert), and **data contracts**
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
- **Lazy chart bundle:** `ChartRenderer` (which transitively imports recharts, ~440kB) is loaded
  through `charts/LazyChartRenderer` — a `lazy(() => import('./ChartRenderer'))` wrapped in its own
  Suspense/`ChartSkeleton`. All six render sites import the wrapper, so recharts is no longer in the
  initial `/` chunk; it arrives on first chart paint. `manualChunks.charts` keeps it isolated;
  `rollup-plugin-visualizer` (env-gated, `npm run analyze`) emits a treemap.
- **Test depth + blocking E2E:** Vitest grew to 65 (lib / hooks / store reducers, incl. the
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
- **AI quality is measured, not assumed:** a tiered, value-based golden-set eval (`ai/eval`), a
  bare→grounded RAG-delta, a **history regression** over the user's own trusted queries (AI drift,
  data-isolated via a single demo snapshot), a deterministic **CI floor** on the rule-based engine,
  and a low-accuracy **alert** — feed the AI Quality page + Prometheus. It's an operator/dev tool, so
  the page was pulled from the analyst's sidebar (route-only at `/ai-quality`) and the toy-demo scope
  is labelled honestly in-UI.

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
- Graceful degradation over hard dependency (Redis, scheduler, Google all optional).
- Frontend theming via CSS-variable tokens (light/dark) consumed by Tailwind;
  emerald accent, Source Serif 4 display. State in small Zustand stores per domain.
