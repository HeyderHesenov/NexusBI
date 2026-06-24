# NexusBI — Natural Language to Dashboard

Biznes sualını adi dildə yaz → NexusBI avtomatik **SQL qurur, icra edir, optimal
chart seçir və biznes insight verir**. SQL bilməyən analist, menecer və rəhbərlər
üçün AI-powered BI platforması.

> AI layer **OpenAI gpt-4o** ilə işləyir (Text2SQL · chart seçimi · insight).

---

## Nə edir

- 🗣️ **Natural language sorğu** — "Regionlar üzrə satış payı" yaz, cavabı al.
- 🧠 **Text2SQL** — sual təhlükəsiz `SELECT`-ə çevrilir (guard + re-validation).
- 📊 **Avtomatik chart + əl ilə keçid** — bar · line · area · pie · scatter · cədvəl;
  istifadəçi istədiyi görünüşə keçir, CSV-yə export edir.
- 💡 **AI insight** — nəticədən qısa biznes təhlili (sorğunun dilində).
- 🧩 **İnteraktiv dashboard** — sorğuları panelə yığ, widget-ləri sürüklə/ölç
  (react-grid-layout), layout avtomatik saxlanılır.
- 🔐 **Auth** — email/şifrə (JWT) + **Google Sign-In** (build-ready).
- 🎨 **Soft Dark Pro UI** — qrafit fon, tək emerald vurgu, aurora login fonu.
- 🧪 **Demo mode** — real DB olmadan seeded in-memory SQLite üzərində işləyir.

---

## Architecture

```
┌───────────────┐     HTTP/JSON      ┌──────────────────────────────┐
│ React + TS    │ ─────────────────▶ │        FastAPI (async)        │
│ Vite·Tailwind │                    │  api/v1: auth query dashboard │
│ Recharts·RGL  │ ◀───────────────── │           datasource          │
│ Zustand       │   QueryResult      │            │                  │
└───────────────┘                    │            ▼                  │
                                     │   services/query_service      │
                                     │   ┌────────┴─────────┐        │
                                     │   ▼                  ▼        │
                                     │ ai/text2sql   ai/chart_select │
                                     │ ai/insight    (OpenAI gpt-4o) │
                                     │   │                           │
                                     │   ▼  SQL guard → execute      │
                                     └───┬──────────┬───────┬────────┘
                                         ▼          ▼       ▼
                                   PostgreSQL    Redis    Demo SQLite
                                   (datasource)  (cache)  (in-memory)
```

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
```

Aç: **http://localhost:5173**  ·  API docs: **http://localhost:8000/docs**

> ⚠️ Brauzerdə **`localhost`** işlət, `127.0.0.1` yox — CORS yalnız `localhost`-a
> icazə verir.

Demo rejimində (`DEMO_MODE=true`) yalnız `OPENAI_API_KEY` kifayətdir; `DATABASE_URL`
avtomatik SQLite-a düşür.

---

## API Endpoints

| Metod | Yol | Təsvir |
|-------|-----|--------|
| POST | `/api/v1/auth/register` | Qeydiyyat → JWT |
| POST | `/api/v1/auth/login` | Giriş → JWT |
| GET | `/api/v1/auth/me` | Cari istifadəçi |
| GET | `/api/v1/auth/providers` | Google enabled? + client_id |
| POST | `/api/v1/auth/google` | Google ID-token → JWT |
| POST/GET/DELETE | `/api/v1/datasource/...` | Datasource connect/list/schema/test/sil |
| POST | `/api/v1/query/ask` | NL sorğu → QueryResult |
| GET | `/api/v1/query/history` | Tarixçə (pagination) |
| GET | `/api/v1/query/{id}` | Saxlanmış nəticə |
| POST | `/api/v1/query/{id}/retry` | Yenidən icra |
| POST/GET/PUT/DELETE | `/api/v1/dashboard/...` | Dashboard CRUD + widget (+ chart snapshot) |

---

## Environment Variables

| Dəyişən | Təsvir |
|---------|--------|
| `OPENAI_API_KEY` | OpenAI açarı (məcburi) |
| `OPENAI_MODEL` | Default `gpt-4o` |
| `GOOGLE_CLIENT_ID` | Google OAuth Web client ID — boşdursa Google düyməsi deaktiv |
| `DATABASE_URL` | Async DSN (postgresql+asyncpg / sqlite+aiosqlite) |
| `REDIS_URL` | Redis (demoda opsional) |
| `SECRET_KEY` | JWT imza açarı (prod-da məcburi, ≥32 simvol) |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | Token müddəti (default 60) |
| `FERNET_KEY` | Datasource connection string şifrələmə açarı (prod-da məcburi) |
| `DEMO_MODE` | `true` → seeded in-memory SQLite |
| `CORS_ORIGINS` | İcazəli origin-lər (vergüllə) |

Frontend (`frontend/.env`): `VITE_API_URL`, `VITE_DEMO_MODE`.

---

## Demo Mode

`DEMO_MODE=true` və datasource seçilməyəndə:
- `app/db/demo_data.py` synthetic `sales · customers · products` cədvəllərini
  in-memory SQLite-a yığır.
- AI-nin qurduğu SQL **real** olaraq bu baza üzərində icra olunur — saxta data deyil.
- Frontend-də "Demo mode" göstəricisi görünür.

---

## Tests

```bash
cd backend && pytest        # 15 test — text2sql/SQL-guard, query pipeline, dashboard, auth
```

---

## Stack

**Backend:** FastAPI · SQLAlchemy 2.0 async · Pydantic v2 · Alembic · OpenAI ·
JWT (python-jose) · Fernet · Redis · structlog · google-auth
**Frontend:** React 18 · TypeScript · Vite · TailwindCSS · Recharts ·
react-grid-layout · Zustand · React Router · react-hot-toast

---

## Security

- **SELECT-only SQL guard** — literal-aware; write/DDL, `SELECT … INTO` və təhlükəli
  funksiyalar (`load_extension`, `pg_sleep`, `pg_read_file` …) bloklanır; hər iki
  executor-da (canlı + demo) re-validate olunur, sətir cap (10k).
- **User-scoped queries** — bütün sorğular `user_id` ilə daraldılır (IDOR yox);
  widget yad query-log-a bağlana bilməz.
- **Google Sign-In** — `email_verified` yoxlanılır, token non-blocking verify olunur,
  get-or-create race-safe.
- Connection string-lər **Fernet** ilə şifrəli; JWT bütün qorunan endpoint-lərdə.
- Prod-da `SECRET_KEY`/`FERNET_KEY` təyin olunmasa start fail edir; CORS Bearer-only.
- CSV export-da formula-injection mühafizəsi. `.env` və sirlər repo-ya commit olunmur.
