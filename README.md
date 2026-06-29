# NexusBI — Natural Language to Dashboard

[![CI](https://github.com/HeyderHesenov/NexusBI/actions/workflows/ci.yml/badge.svg)](https://github.com/HeyderHesenov/NexusBI/actions/workflows/ci.yml)

Biznes sualını adi dildə yaz → NexusBI avtomatik **SQL qurur, icra edir, optimal
chart seçir və biznes insight verir**. SQL bilməyən analist, menecer və rəhbərlər
üçün AI-powered BI platforması.

> Daxili **AI mühərriki** ilə işləyir (Text2SQL · chart seçimi · insight · proqnoz ·
> anomaliya · kök-səbəb · proaktiv digest · agentik copilot). Üstəlik komanda idarəetməsi
> (RBAC + row-level security), embedded analytics + white-label, FP&A ssenari planlaması.

---

## Nə edir

### Sorğu & vizuallaşdırma
- 🗣️ **Natural language sorğu** — "Regionlar üzrə satış payı" yaz, cavabı al.
- 💬 **Chat-with-your-data** — çoxdönüşlü follow-up: "bunu aya görə böl", "yalnız 2024";
  əvvəlki sual+SQL kontekst kimi saxlanılır.
- 🧠 **Text2SQL** — sual təhlükəsiz `SELECT`-ə çevrilir (guard + re-validation).
- 📊 **Avtomatik chart + əl ilə keçid** — bar · line · area · pie · scatter · cədvəl;
  CSV export, drill-down filtr (qrafik elementinə klik).
- 💡 **AI insight** — nəticədən qısa biznes təhlili (sorğunun dilində).
- 🔮 **Proqnoz (forecast)** + 🚨 **anomaliya aşkarlama** — AI mühərriki ilə.
- 🧭 **"Bunu izah et" (kök-səbəb)** — nəticəni ən böyük driver-lərə parçalayır (seqment + töhfə %).
- 🌳 **"Niyə?" iyerarxik kök-səbəb ağacı** — metrikanı çoxsəviyyəli driver ağacına böl
  (interaktiv, töhfə %); AI çatmayanda determinik fallback.
- 🧬 **Mənşə (lineage)** — nəticənin arxasındakı cədvəl/sütun/metriklər (determinik SQL parse).

### Proaktiv AI
- 🌅 **Səhər brifi (digest)** — app özü son sorğularını skan edir, ən vacib dəyişiklikləri
  səbəbi ilə bir bildirişdə toplayır (planlı + on-demand).
- ✨ **Smart insight bildirişləri** — saxlanan sorğu nəticələrindəki diqqətəlayiq dəyişikliklər.
- 🤖 **Agentik Copilot (plan → təsdiq → icra)** — köməkçi əvvəl addım planı göstərir, sən
  təsdiqləyirsən, sonra icra edir (sorğu işlət · dashboard qur/paylaş · metrik/alert/sorğu yarat).

### Ssenari & FP&A
- 🎯 **KPI hədəf + pacing** — hədəfə çatma sürəti (tempo markeri ilə gauge).
- 🎯 **Goal-seek** — "hədəfə çatmaq üçün neçə % lazımdır?".
- 🎲 **Monte Carlo** — tarixi gəlirlərdən P10/P50/P90 qeyri-müəyyənlik diapazonu (determinik seed).
- 🎚️ **What-if ssenari** — metrikə % düzəliş → faktiki vs proqnoz.

### BA workflow
- 📝 **Tələbnamədən dashboard** — BRD / user story yapışdır və ya yüklə → AI ölçülə bilən
  KPI çıxarır → təsdiqlədikdən sonra tam dashboard qurur (tələb→KPI izlənilirlik).

### Qərarlar & izləmə
- 🎯 **Qərar jurnalı** — insight → action → outcome; status izləmə (analitikanı təsirə bağlayır).
- 🔔 **Alert-lər & monitorlar** — saxlanan sorğuya threshold bağla → şərt pozulanda bildiriş mərkəzi.
- 🔌 **Workflow inteqrasiyaları** — brif/alert-ləri Slack · Teams · email-ə göndər (mock-first,
  config-gated); dashboard chat-də **@mention** → bildiriş.

### Data mənbələri & hazırlıq
- 🔌 **Öz SQL bazanı qoş** — PostgreSQL / SQLite (connection string, şifrəli saxlanılır).
- 📁 **CSV / Excel yüklə** — fayl avtomatik sorğulana bilən SQLite cədvəlinə çevrilir.
- 🪄 **NL data-prep + çoxcədvəli join** — "orders ilə customers-i birləşdir, aylıq qrupla"
  → AI transform planı → önizləmə → yeni törəmə mənbə kimi saxla (SELECT-only guard).
- 📊 **Data profiling** — sütun üzrə null % · distinct · min/max · tip (nümunə əsaslı).
- 🔎 **Schema browser + schema-bilən nümunə sorğular**.
- 🔵 **Power BI inteqrasiyası** — NL→DAX (mock-first; real Azure AD ilə canlı executeQueries).
- 🧪 **Demo mode** — real DB olmadan seeded SQLite üzərində işləyir.

### Semantik qat, etibar & dashboardlar
- 🏷️ **Metrik kataloqu (semantik qat)** — biznes metriklərini bir dəfə təyin et
  (ad, ifadə, sinonimlər); AI sorğularda tutarlı işlədir.
- ✅ **Etibar qatı** — metrikləri **sertifikatla** (verified badge + sahib), nəticə **lineage**-i,
  datasource **freshness SLA** (təzə / köhnəlib nişanı). "Tək həqiqət mənbəyi".
- 🧩 **İnteraktiv dashboard** — widget-ləri sürüklə/ölç (react-grid-layout), auto-save,
  per-widget mənbə nişanı + yenilə, **cross-filter** (bir widget-də klik → bütün panel filtrlənir).
- 🔴 **Canlı (real-time) dashboard** + 🎬 **AI Data Story** (kinematik təqdimat) + 🤖 **Copilot**.
- 🔖 **Saxlanan sorğular + cədvəlli (cron) avto-yeniləmə** ("Hesabatlar").

### Komanda & idarəetmə (enterprise)
- 👥 **Workspace + rollar (RBAC)** — owner / editor / viewer; e-poçtla dəvət.
- 🔒 **Row-level security (RLS)** — üzv yalnız icazəli sətirləri görür (fail-closed; canlı +
  refresh yollarında tətbiq olunur).
- 🧾 **Audit jurnalı** — təhlükəsizlik-əhəmiyyətli əməllərin izi (kim/nə/nə vaxt).

### Embed & white-label
- 🧩 **Embedded analytics** — imzalı read-only embed token; iframe + yüngül `embed.js` SDK
  (auto-mount); söndürmə dərhal bütün tokenləri ləğv edir.
- 🎨 **White-label brendinq** — ad · əsas rəng · loqo (embed görünüşünə tətbiq olunur).
- 🔗 **Paylaşma** — tokenli read-only public dashboard linki + komanda chat.

### Hesab & platforma
- 🔐 **Auth** — email/şifrə (JWT) + **Google Sign-In**; **refresh-token rotation**
  (reuse-detection + family-revoke) və `/auth/logout`.
- 💳 **Abunə planları + per-user rate limiting** — Free/Pro/Max/Max+ aylıq AI limiti;
  demo-da mock upgrade, prod-da **config-gated Stripe Checkout**.
- 🎨 **Claude-ilhamlı UI** — light/dark toggle, emerald accent, Source Serif 4 başlıqlar.
- ⚡ **Performans** — Redis nəticə keşi (user-scoped), per-datasource connection pooling.
- 📈 **Müşahidə** — Prometheus `/metrics`, struktur loglar.

---

## Architecture

```
┌───────────────┐     HTTP/JSON      ┌──────────────────────────────────────────┐
│ React + TS    │ ─────────────────▶ │              FastAPI (async)              │
│ Vite·Tailwind │                    │ api/v1: auth query dashboard datasource    │
│ Recharts·RGL  │ ◀───────────────── │ metric saved billing branding requirement  │
│ Zustand       │   QueryResult      │ dataprep scenario workspace integration    │
└───────────────┘                    │ copilot decision public(+embed)            │
                                     │            │                               │
                                     │            ▼                               │
                                     │   services/query_service                   │
                                     │   • rate-limit · user-scoped result cache   │
                                     │   • metrics + chat context (prompt) · RLS   │
                                     │   ┌────────┴─────────┐                     │
                                     │   ▼                  ▼                     │
                                     │ ai/text2sql   ai/chart_selector             │
                                     │ ai/insight·forecast·anomaly·root_cause      │
                                     │ ai/requirements·data_prep·copilot (AI eng.) │
                                     │   │  SQL guard → engine pool → exec → RLS   │
                                     │   ▼                                         │
                                     │ services: digest·requirement·data_prep·     │
                                     │  profiling·lineage·workspace·rls·audit·     │
                                     │  scenario·embed·brand·integration(s)        │
                                     │ scheduler (saved-query refresh + digest)    │
                                     │ realtime hub + live_refresh (WS)            │
                                     └──┬──────────┬───────┬──────────┬───────────┘
                                        ▼          ▼       ▼          ▼
                                  PostgreSQL    Redis   Demo/CSV   Slack/Teams/
                                  (datasource) (cache)  SQLite     email · Stripe
                                                                   (mock-first)
```

**Axın (`process_nl_query`):** rate-limit → **user-scoped** cache yoxla → (metrik + söhbət
kontekstini prompt-a inject) → Text2SQL → SQL guard → pooled engine ilə icra → **RLS
filtri** → chart + insight (paralel) → QueryLog + cache → QueryResult. On-demand AI
təhlilləri (`root-cause`, `forecast`, `anomaly`, `explain`) və determinik hesablamalar
(`goal-seek`, `monte-carlo`, `lineage`, `profiling`) ayrıca endpoint-lərdir.

Ətraflı: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## Quick Start

```bash
# 1. Konfiqurasiya
cp .env.example .env
#   OPENAI_API_KEY + OPENAI_MODEL — AI mühərriki üçün (real AI; demo offline fallback işlədir)
#   SECRET_KEY:  python -c "import secrets; print(secrets.token_urlsafe(48))"
#   FERNET_KEY:  python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"

# 2a. Docker ilə hər şey (PostgreSQL + Redis + backend + frontend)
docker-compose up
```

### Docker olmadan (lokal dev)

```bash
# Backend
cd backend
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload --port 8000

# Frontend (yeni terminal)
cd frontend
npm install && npm run dev

# Redis (opsional, nəticə keşi üçün) — macOS:
brew install redis && brew services start redis
```

Aç: **http://localhost:5173**  ·  API docs: **http://localhost:8000/docs**

> ⚠️ Brauzerdə **`localhost`** işlət, `127.0.0.1` yox — CORS yalnız `localhost`-a icazə verir.

Demo rejimində (`DEMO_MODE=true`) yalnız `OPENAI_API_KEY` kifayətdir; `DATABASE_URL`
avtomatik SQLite-a düşür və başlanğıcda **limitsiz demo hesab** seed olunur:
`demo@nexusbi.io` / `demo1234`.

---

## API Endpoints

| Metod | Yol | Təsvir |
|-------|-----|--------|
| POST | `/api/v1/auth/register` · `/login` · `/google` | Auth → access + refresh token cütü |
| POST | `/api/v1/auth/refresh` · `/logout` | Token rotation (reuse-detect) · refresh ləğvi |
| GET | `/api/v1/auth/me` · `/providers` | Cari user · Google config |
| POST/GET/DELETE | `/api/v1/datasource/...` | Connect/list/schema/test/sil |
| POST | `/api/v1/datasource/upload` | CSV/Excel → SQLite datasource |
| POST | `/api/v1/query/ask` | NL sorğu (+ `previous_query_log_id` follow-up) → QueryResult |
| GET | `/api/v1/query/history` · `/{id}` | Tarixçə · saxlanmış nəticə |
| POST | `/api/v1/query/{id}/retry` · `/anomalies` · `/forecast` · `/explain` | Yenidən · anomaliya · proqnoz · kök-səbəb |
| POST/GET | `/api/v1/query/{id}/root-cause` · `/goal-seek` · `/monte-carlo` · `/lineage` | Kök-səbəb ağacı · goal-seek · Monte Carlo · mənşə |
| POST/GET/PUT/DELETE | `/api/v1/dashboard/...` | Dashboard CRUD + widget (+ refresh / story / live) |
| POST/DELETE/PATCH | `/api/v1/dashboard/{id}/share` · `/embed` | Public token · imzalı embed token |
| GET | `/api/v1/public/dashboard/{token}` · `/public/embed/{token}` | Auth-suz read-only paylaşma · embed (brand-aware) |
| POST/GET/DELETE/PATCH | `/api/v1/metrics/...` (+ `/{id}/verify`) | Metrik CRUD + sertifikatlama |
| POST | `/api/v1/requirements/extract` · `/{id}/build` | BRD → KPI çıxar · dashboard qur |
| POST | `/api/v1/dataprep/preview` · `/materialize` | NL transform önizlə · mənbə kimi saxla |
| GET/POST/DELETE/PATCH | `/api/v1/datasource/{id}/profile` · `/rls` · `/sla` | Profiling · RLS qaydaları · freshness SLA |
| POST/GET/PUT/DELETE | `/api/v1/kpi-targets/...` | KPI hədəf + pacing |
| GET/POST/DELETE | `/api/v1/workspaces/...` (+ `/members`) · `/audit` | Workspace + RBAC üzvlük · audit jurnalı |
| GET/POST/DELETE | `/api/v1/integrations/...` (+ `/{id}/test`) | Slack/Teams/email kanalları |
| GET/PUT | `/api/v1/brand` | White-label brendinq |
| POST | `/api/v1/copilot/chat` (mode=plan/execute) | Agentik copilot (plan → icra) |
| POST/GET/DELETE | `/api/v1/saved/...` · `/alerts` · `/notifications` (+ `/digest`) | Saxlanan sorğular · monitorlar · brif |
| POST/GET/PUT/DELETE | `/api/v1/decisions/...` | Qərar jurnalı (insight→action→outcome) |
| GET/POST | `/api/v1/billing/plans` · `/usage` · `/upgrade` · `/checkout` | Planlar · istifadə · mock upgrade · Stripe (gated) |
| GET | `/health` · `/metrics` | Sağlamlıq · Prometheus metrikləri |

---

## Environment Variables

| Dəyişən | Təsvir |
|---------|--------|
| `OPENAI_API_KEY` / `OPENAI_MODEL` | AI mühərriki açarı + mühərrik identifikatoru (.env-dən, məcburi) |
| `GOOGLE_CLIENT_ID` | Google OAuth Web client ID (boşdursa düymə deaktiv) |
| `DATABASE_URL` | Async DSN (postgresql+asyncpg / sqlite+aiosqlite) |
| `REDIS_URL` / `CACHE_TTL_SECONDS` | Redis (opsional) · nəticə keşi TTL (default 300) |
| `DATASOURCE_POOL_SIZE` / `_MAX_OVERFLOW` / `_RECYCLE_SECONDS` / `DATASOURCE_MAX_ENGINES` | Datasource connection pool |
| `APP_DB_POOL_SIZE` / `_MAX_OVERFLOW` / `_RECYCLE_SECONDS` | Tətbiq DB-si üçün pool (non-sqlite) |
| `QUERY_TIMEOUT_SECONDS` / `SQLGEN_CACHE_TTL_SECONDS` | SQL icra timeout-u · NL→SQL generasiya keşi |
| `UPLOAD_DIR` / `UPLOAD_MAX_BYTES` | CSV/Excel yükləmə qovluğu · limit (10 MB) |
| `SCHEDULER_ENABLED` / `SCHEDULER_INTERVAL_SECONDS` | Saxlanan sorğu cədvəli |
| `DIGEST_ENABLED` / `DIGEST_HOUR_UTC` / `DIGEST_MAX_ITEMS` | Proaktiv səhər brifi |
| `LIVE_REFRESH_ENABLED` / `LIVE_REFRESH_TICK_SECONDS` / `LIVE_DEMO_FEED` | Canlı dashboard |
| `COPILOT_MAX_STEPS` | Agentik copilot tool-loop limiti |
| `INTEGRATIONS_LIVE` / `SMTP_HOST·PORT·USERNAME·PASSWORD·FROM` | Slack/Teams/email (boşdursa mock) |
| `STRIPE_SECRET_KEY` / `STRIPE_SUCCESS_URL` / `STRIPE_CANCEL_URL` | Stripe Checkout (boşdursa gated/mock) |
| `POWERBI_TENANT_ID·CLIENT_ID·CLIENT_SECRET` / `POWERBI_API_BASE` / `POWERBI_MAX_ROWS` | Power BI (boşdursa mock provider) · REST baza · sətir cap |
| `SECRET_KEY` / `ACCESS_TOKEN_EXPIRE_MINUTES` / `REFRESH_TOKEN_EXPIRE_DAYS` | JWT açarı (prod ≥32) · access müddət (default 30 dəq) · refresh müddət |
| `METRICS_TOKEN` | `/metrics` üçün bearer (prod; demo-da loopback) |
| `FERNET_KEY` | Datasource & inteqrasiya sirlərinin şifrələnməsi (prod məcburi) |
| `DEMO_MODE` / `CORS_ORIGINS` | Demo SQLite · icazəli origin-lər |

Frontend (`frontend/.env`): `VITE_API_URL`.

---

## Tests

```bash
cd backend && pytest        # 220 test
```
Əhatə: text2sql/SQL-guard & **SQL-hardening** (metadata denylist · schema allowlist · timeout) ·
query pipeline & user-scoped cache · dashboard (+refresh/share/embed) · auth & **refresh-token
rotation/reuse-detect** · rate-limit & tiers · datasource & CSV upload · anomaly/forecast/explain ·
**root-cause · requirements→dashboard · NL data-prep & profiling · agentik copilot
(plan/execute) · trust (verified/lineage/SLA) · workspace RBAC + SQL-səviyyə RLS + audit · scenario
(goal-seek/Monte Carlo/pacing) · integrations (+ @mention) · embed/white-label/Stripe gate** ·
saved-query & scheduler · engine pool · metric catalog · chat context · alerts · decisions ·
təhlükəsizlik (pentest fixes). Frontend: Vitest (ModalShell a11y · ErrorBoundary).

CI: hər push/PR-da GitHub Actions backend (ruff + pytest) və frontend (build) işlədir.

---

## Stack

**Backend:** FastAPI · SQLAlchemy 2.0 async · Pydantic v2 · Alembic · AI mühərriki (async client) ·
sqlglot (SQL guard/RLS) · JWT (python-jose) · Fernet · Redis · pandas/openpyxl/numpy ·
WebSockets (canlı/collab) · prometheus-client · structlog · google-auth · httpx
**Frontend:** React 18 · TypeScript · Vite · TailwindCSS (CSS-var light/dark) · Recharts ·
react-grid-layout · Zustand · React Router · react-hot-toast

---

## Security

- **SELECT-only SQL guard** — literal-aware; write/DDL, `SELECT … INTO` və təhlükəli
  funksiyalar bloklanır; hər iki executor-da (canlı + demo) re-validate, sətir cap (10k).
- **User-scoped queries & IDOR mühafizəsi** — bütün sorğular `user_id`/`owner_id` ilə daralır;
  widget yad query-log-a bağlana bilməz; **query nəticə keşi user-scoped** (RLS sızması yox).
- **Row-level security (RLS)** — üzv yalnız icazəli sətirləri görür; **fail-closed**.
  Filtr **SQL səviyyəsində** (`rls_sql.constrain_sql`, sqlglot) aqreqatdan əvvəl inject olunur
  (SUM/GROUP BY sızması bağlı); post-fetch Python filtri fallback. Canlı + dashboard-refresh
  yollarında da tətbiq olunur.
- **Text2SQL sərtləşməsi** — metadata-cədvəl denylist (tırnaq-bypass-a davamlı), schema
  allowlist (schema-qualifier rədd), Postgres/MySQL statement timeout; generation keşi user-müstəqil.
- **Refresh-token rotation** — hər yeniləmədə rotasiya + reuse-detection (oğurlanan token
  ailəni ləğv edir); access TTL qısa (30 dəq); `/auth/logout` refresh-i ləğv edir.
- **CSP & security header-lər** — build-time `Content-Security-Policy` (script-src 'self' + hash),
  header-lər xəta cavablarında da; `/docs` prod-da bağlı.
- **Frontend dayanıqlılıq** — route + per-widget `ErrorBoundary` (bir panel bütün app-ı
  ağ-ekran etmir), modal a11y (focus-trap/scroll-lock/aria), chart panelləri lazy-load.
- **Audit jurnalı** — datasource/RLS/workspace dəyişiklikləri izlənilir.
- **SSRF guard** — datasource bağlantıları + inteqrasiya webhook-ları `net_guard`-dan keçir
  (private/loopback/metadata blok), **delivery-time-da da re-check** (DNS-rebind pəncərəsi).
- **Embed token** — imzalı, read-only, tək-dashboard (`emb` claim); söndürmə dərhal ləğv edir.
- **@mention təhlükəsizliyi** — yalnız authenticated author; xarici kanallara fan-out YOX
  (cross-tenant phishing bağlı); comment başına cap.
- **Embed brand validasiyası** — `app_name` tag-injection-dan, `logo_url` yalnız http(s),
  `primary_color` strict hex (unauth embed host-a verbatik verildiyi üçün).
- **Per-user rate limiting** — aylıq AI kvotası (tier-ə görə), 429.
- Connection string-lər və inteqrasiya sirləri **Fernet** ilə şifrəli; JWT bütün qorunan endpoint-lərdə.
- Prod-da `SECRET_KEY`/`FERNET_KEY` təyin olunmasa start fail edir; CORS Bearer-only.
- CSV upload validasiyası (tip/ölçü/ad sanitizasiyası); export-da formula-injection mühafizəsi.
- gitleaks + CodeQL + secret-scanning workflow-ları; `.env` və sirlər repo-ya commit olunmur.
