# NexusBI — Natural Language to Dashboard

Biznes sualını adi dildə yaz → NexusBI avtomatik SQL qurur, icra edir, optimal
chart seçir və biznes insight verir. SQL bilməyən analist, menecer və rəhbərlər
üçün AI-powered BI platforması.

> AI layer **OpenAI gpt-4o** ilə işləyir (Text2SQL · chart seçimi · insight).

---

## Architecture

```
┌──────────────┐      HTTP/JSON       ┌──────────────────────────────┐
│  React + TS  │ ───────────────────▶ │        FastAPI (async)       │
│  Vite·Tailwind│                      │                              │
│  Recharts    │ ◀─────────────────── │  api/v1: auth query dashboard│
└──────────────┘   QueryResult        │           datasource         │
                                       │            │                 │
                                       │            ▼                 │
                                       │   services/query_service     │
                                       │   ┌────────┴─────────┐       │
                                       │   ▼                  ▼       │
                                       │ ai/text2sql   ai/chart_select│
                                       │ ai/insight    (OpenAI gpt-4o)│
                                       │   │                          │
                                       │   ▼                          │
                                       │ SQL guard → execute          │
                                       └───┬──────────┬───────┬───────┘
                                           ▼          ▼       ▼
                                     PostgreSQL    Redis    Demo SQLite
                                     (datasource)  (cache)  (in-memory)
```

## Quick Start

```bash
# 1. Konfiqurasiya
cp .env.example .env
# .env-də doldur: OPENAI_API_KEY, SECRET_KEY, FERNET_KEY
#   SECRET_KEY:  python -c "import secrets; print(secrets.token_urlsafe(48))"
#   FERNET_KEY:  python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"

# 2. Docker ilə hər şey (PostgreSQL + Redis + backend + frontend)
docker-compose up

# Frontend → http://localhost:5173   ·   API docs → http://localhost:8000/docs
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

Demo rejimində (`DEMO_MODE=true`) `DATABASE_URL` SQLite-a düşür və real DB
lazım deyil — yalnız `OPENAI_API_KEY` kifayətdir.

## API Endpoints

| Metod | Yol | Təsvir |
|-------|-----|--------|
| POST | `/api/v1/auth/register` | Qeydiyyat → JWT |
| POST | `/api/v1/auth/login` | Giriş → JWT |
| GET | `/api/v1/auth/me` | Cari istifadəçi |
| POST | `/api/v1/datasource/` | Datasource əlavə et (şifrəli) |
| GET | `/api/v1/datasource/` | Datasource siyahısı |
| GET | `/api/v1/datasource/{id}/schema` | Schema qaytar |
| POST | `/api/v1/datasource/{id}/test` | Bağlantı testi |
| DELETE | `/api/v1/datasource/{id}` | Sil |
| POST | `/api/v1/query/ask` | NL sorğu → QueryResult |
| GET | `/api/v1/query/history` | Tarixçə (pagination) |
| GET | `/api/v1/query/{id}` | Saxlanmış nəticə |
| POST | `/api/v1/query/{id}/retry` | Yenidən icra |
| POST/GET/PUT/DELETE | `/api/v1/dashboard/...` | Dashboard CRUD + widget |

## Environment Variables

| Dəyişən | Təsvir |
|---------|--------|
| `OPENAI_API_KEY` | OpenAI açarı (məcburi) |
| `OPENAI_MODEL` | Default `gpt-4o` |
| `DATABASE_URL` | Async DSN (postgresql+asyncpg / sqlite+aiosqlite) |
| `REDIS_URL` | Redis (demoda opsional) |
| `SECRET_KEY` | JWT imza açarı |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | Token müddəti (default 60) |
| `FERNET_KEY` | Datasource connection string şifrələmə açarı |
| `DEMO_MODE` | `true` → seeded in-memory SQLite |
| `CORS_ORIGINS` | İcazəli origin-lər (vergüllə) |

## Demo Mode

`DEMO_MODE=true` və datasource seçilməyəndə:
- `app/db/demo_data.py` synthetic `sales · customers · products` cədvəllərini
  in-memory SQLite-a yığır.
- AI-nin qurduğu SQL **real** olaraq bu baza üzərində icra olunur — saxta
  data deyil, əsl aqreqasiya nəticələri.
- Frontend-də "Demo mode" banneri görünür.

## Tests

```bash
cd backend && pytest        # 11 test — text2sql, query pipeline, dashboard CRUD
```

## Stack

Backend: FastAPI · SQLAlchemy 2.0 async · Pydantic v2 · Alembic · OpenAI ·
JWT · Fernet · Redis · structlog
Frontend: React 18 · TypeScript · Vite · TailwindCSS · Recharts · Zustand ·
React Router · react-hot-toast

## Security

- SELECT-only SQL guard (write/DDL bloklanır)
- Connection string-lər Fernet ilə şifrəli saxlanılır
- JWT auth bütün qorunan endpoint-lərdə
- `.env` və sirlər repo-ya commit olunmur
