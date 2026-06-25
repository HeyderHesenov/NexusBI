# NexusBI — Natural Language to Dashboard

[![CI](https://github.com/HeyderHesenov/nexusbi/actions/workflows/ci.yml/badge.svg)](https://github.com/HeyderHesenov/nexusbi/actions/workflows/ci.yml)

Biznes sualını adi dildə yaz → NexusBI avtomatik **SQL qurur, icra edir, optimal
chart seçir və biznes insight verir**. SQL bilməyən analist, menecer və rəhbərlər
üçün AI-powered BI platforması.

> AI layer **OpenAI gpt-4o** ilə işləyir (Text2SQL · chart seçimi · insight · proqnoz · anomaliya).

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
- 🔮 **Proqnoz (forecast)** + 🚨 **anomaliya aşkarlama** — gpt-4o ilə.

### Data mənbələri
- 🔌 **Öz SQL bazanı qoş** — PostgreSQL / SQLite (connection string, şifrəli saxlanılır).
- 📁 **CSV / Excel yüklə** — fayl avtomatik sorğulana bilən SQLite cədvəlinə çevrilir.
- 🔎 **Schema browser + schema-bilən nümunə sorğular**.
- 🧪 **Demo mode** — real DB olmadan seeded SQLite üzərində işləyir.

### Semantik qat & dashboardlar
- 🏷️ **Metrik kataloqu (semantik qat)** — biznes metriklərini bir dəfə təyin et
  (ad, ifadə, sinonimlər); AI sorğularda tutarlı işlədir.
- 🧩 **İnteraktiv dashboard** — widget-ləri sürüklə/ölç (react-grid-layout), auto-save,
  per-widget mənbə nişanı + yenilə, **cross-filter** (bir widget-də klik → bütün panel filtrlənir).
- 🔖 **Saxlanan sorğular + cədvəlli (cron) avto-yeniləmə** ("Hesabatlar").

### Hesab & platforma
- 🔐 **Auth** — email/şifrə (JWT) + **Google Sign-In**.
- 💳 **Abunə planları + per-user rate limiting** — Free/Pro/Max/Max+ aylıq AI limiti (mock upgrade).
- 🎨 **Claude-ilhamlı UI** — light/dark toggle, emerald accent, Source Serif 4 başlıqlar.
- ⚡ **Performans** — Redis nəticə keşi, per-datasource connection pooling.
- 📈 **Müşahidə** — Prometheus `/metrics`, struktur loglar.

---

## Architecture

```
┌───────────────┐     HTTP/JSON      ┌────────────────────────────────────┐
│ React + TS    │ ─────────────────▶ │            FastAPI (async)          │
│ Vite·Tailwind │                    │  api/v1: auth query dashboard       │
│ Recharts·RGL  │ ◀───────────────── │  datasource metrics saved billing   │
│ Zustand       │   QueryResult      │            │                        │
└───────────────┘                    │            ▼                        │
                                     │   services/query_service            │
                                     │   • rate-limit · result cache        │
                                     │   • metrics + chat context (prompt)  │
                                     │   ┌────────┴─────────┐              │
                                     │   ▼                  ▼              │
                                     │ ai/text2sql   ai/chart_selector      │
                                     │ ai/insight·forecast·anomaly (gpt-4o) │
                                     │   │  SQL guard → engine pool → exec  │
                                     │   ▼                                  │
                                     │ scheduler (saved-query refresh)      │
                                     └───┬──────────┬───────┬───────────────┘
                                         ▼          ▼       ▼
                                   PostgreSQL    Redis    Demo / CSV SQLite
                                   (datasource) (cache)   (file-backed)
```

**Axın:** `process_nl_query` → rate-limit yoxla → cache yoxla → (metrik + söhbət
kontekstini prompt-a inject) → Text2SQL → SQL guard → pooled engine ilə icra →
chart + insight (paralel) → QueryLog + cache → QueryResult.

Ətraflı: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## Quick Start

```bash
# 1. Konfiqurasiya
cp .env.example .env
#   OPENAI_API_KEY — məcburi
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
| POST | `/api/v1/auth/register` · `/login` · `/google` | Auth → JWT |
| GET | `/api/v1/auth/me` · `/providers` | Cari user · Google config |
| POST/GET/DELETE | `/api/v1/datasource/...` | Connect/list/schema/test/sil |
| POST | `/api/v1/datasource/upload` | CSV/Excel → SQLite datasource |
| POST | `/api/v1/query/ask` | NL sorğu (+ `previous_query_log_id` follow-up) → QueryResult |
| GET | `/api/v1/query/history` · `/{id}` | Tarixçə · saxlanmış nəticə |
| POST | `/api/v1/query/{id}/retry` · `/anomalies` · `/forecast` | Yenidən · anomaliya · proqnoz |
| POST/GET/PUT/DELETE | `/api/v1/dashboard/...` | Dashboard CRUD + widget (+ refresh / refresh-all) |
| POST/GET/DELETE | `/api/v1/metrics/...` | Metrik (semantik qat) CRUD |
| POST/GET/PUT/DELETE | `/api/v1/saved/...` (+ `/{id}/run`) | Saxlanan sorğular + cədvəl |
| GET/POST | `/api/v1/billing/plans` · `/usage` · `/upgrade` | Planlar · istifadə · (mock) upgrade |
| GET | `/health` · `/metrics` | Sağlamlıq · Prometheus metrikləri |

---

## Environment Variables

| Dəyişən | Təsvir |
|---------|--------|
| `OPENAI_API_KEY` / `OPENAI_MODEL` | OpenAI açarı (məcburi) · model (default `gpt-4o`) |
| `GOOGLE_CLIENT_ID` | Google OAuth Web client ID (boşdursa düymə deaktiv) |
| `DATABASE_URL` | Async DSN (postgresql+asyncpg / sqlite+aiosqlite) |
| `REDIS_URL` / `CACHE_TTL_SECONDS` | Redis (opsional) · nəticə keşi TTL (default 300) |
| `DATASOURCE_POOL_SIZE` / `_MAX_OVERFLOW` / `_RECYCLE_SECONDS` / `DATASOURCE_MAX_ENGINES` | Connection pool |
| `UPLOAD_DIR` / `UPLOAD_MAX_BYTES` | CSV/Excel yükləmə qovluğu · limit (10 MB) |
| `SCHEDULER_ENABLED` / `SCHEDULER_INTERVAL_SECONDS` | Saxlanan sorğu cədvəli |
| `SECRET_KEY` / `ACCESS_TOKEN_EXPIRE_MINUTES` | JWT açarı (prod ≥32) · müddət |
| `FERNET_KEY` | Datasource connection string şifrələmə (prod məcburi) |
| `DEMO_MODE` / `CORS_ORIGINS` | Demo SQLite · icazəli origin-lər |

Frontend (`frontend/.env`): `VITE_API_URL`.

---

## Tests

```bash
cd backend && pytest        # 39 test
```
Əhatə: text2sql/SQL-guard · query pipeline & cache · dashboard (+refresh) · auth ·
rate-limit & tiers · datasource & CSV upload · anomaly/forecast · saved-query &
scheduler · engine pool · metric catalog · chat context.

---

## Stack

**Backend:** FastAPI · SQLAlchemy 2.0 async · Pydantic v2 · Alembic · OpenAI ·
JWT (python-jose) · Fernet · Redis · pandas/openpyxl · prometheus-client · structlog · google-auth
**Frontend:** React 18 · TypeScript · Vite · TailwindCSS (CSS-var light/dark) · Recharts ·
react-grid-layout · Zustand · React Router · react-hot-toast

---

## Security

- **SELECT-only SQL guard** — literal-aware; write/DDL, `SELECT … INTO` və təhlükəli
  funksiyalar bloklanır; hər iki executor-da (canlı + demo) re-validate, sətir cap (10k).
- **User-scoped queries & IDOR mühafizəsi** — bütün sorğular `user_id` ilə daralır;
  widget yad query-log-a bağlana bilməz.
- **Per-user rate limiting** — aylıq AI kvotası (tier-ə görə), 429.
- Connection string-lər **Fernet** ilə şifrəli; JWT bütün qorunan endpoint-lərdə.
- Prod-da `SECRET_KEY`/`FERNET_KEY` təyin olunmasa start fail edir; CORS Bearer-only.
- CSV upload validasiyası (tip/ölçü/ad sanitizasiyası); export-da formula-injection mühafizəsi.
- `.env` və sirlər repo-ya commit olunmur.
