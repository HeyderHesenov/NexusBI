# NexusBI — Natural Language to Dashboard

[![CI](https://github.com/HeyderHesenov/NexusBI/actions/workflows/ci.yml/badge.svg)](https://github.com/HeyderHesenov/NexusBI/actions/workflows/ci.yml)

Biznes sualını adi dildə yaz → NexusBI avtomatik **SQL qurur, icra edir, optimal
chart seçir və biznes insight verir**. SQL bilməyən analist, menecer və rəhbərlər
üçün AI-powered BI platforması.

> Daxili **AI mühərriki** ilə işləyir (Text2SQL · chart seçimi · insight · proqnoz ·
> anomaliya · kök-səbəb · proaktiv digest · agentik copilot). Üstəlik komanda idarəetməsi
> (RBAC + row-level security), embedded analytics + white-label, FP&A ssenari planlaması.
>
> **Kurs layihəsi kimi başladı, indi məhsul kimi inkişaf edir** — təqdimat bitib, iş
> davam edir: hər dəyişiklik PR-dan, testlərdən və CI-dan keçir.

---

## Nə edir

### Sorğu & vizuallaşdırma
- **Natural language sorğu** — "Regionlar üzrə satış payı" yaz, cavabı al.
- **Chat-with-your-data** — çoxdönüşlü follow-up: "bunu aya görə böl", "yalnız 2024";
  əvvəlki sual+SQL kontekst kimi saxlanılır.
- **Text2SQL** — sual təhlükəsiz `SELECT`-ə çevrilir (guard + re-validation). Geniş
  sxemlərdə (>8 cədvəl) **sxem-linking** modelə yalnız suala aid cədvəlləri (+ FK
  hədəfləri) göndərir — embedding-cosine top-K, samples HEÇ VAXT (tenant-leak); kiçik
  sxem və ya xəta → tam sxemə fail-open, repair loop tam sxemdə işləyir.
- ⌨**SQL power-user rejimi** — analitik təbii dil əvəzinə **öz SQL-ini yazır və ya
  AI-nin SQL-ini redaktə edib yenidən işlədir** (CodeMirror, sxem-bilən autocomplete).
  Tamamilə **AI-siz** (kvota yemir); eyni təhlükəsizlik zənciri (SELECT-only → cədvəl
  allowlist → RLS fail-closed). `POST /query/run`.
- **Avtomatik chart + əl ilə keçid** — bar · line · area · pie · scatter · cədvəl · **pivot**;
  CSV export, drill-down filtr (qrafik elementinə klik).
- **Qrafik ixracı (PNG/SVG) + dashboard çapı** — hər qrafiki üç səthdən (sorğu · chat paylaşım
  kartı · dashboard widget-i) təsvir kimi yüklə; dashboard isə brauzerin çap dialoqundan PDF-ə
  gedir (ayrıca çap görünüşü, ekran layout-u pozulmadan). Konsultant deliverable-ı üçün.
- **Pivot cədvəl explorer** — nəticə üzərində sürüklə-seç çarpaz analiz (sətir/sütun/ölçü/
  aqreqat: cəm·orta·say·min·maks), SQL-siz — Excel PivotTable eqvivalenti, tam client-side.
- **AI insight** — nəticədən qısa biznes təhlili (sorğunun dilində).
- **Proqnoz (forecast)** + **anomaliya aşkarlama** — AI mühərriki ilə.
- **"Niyə?" iyerarxik kök-səbəb ağacı** — metrikanı çoxsəviyyəli driver ağacına böl
  (interaktiv, töhfə %); AI çatmayanda determinik fallback.
- **Mənşə (lineage)** — nəticənin arxasındakı cədvəl/sütun/metriklər (determinik SQL parse).

### Proaktiv AI
- **Səhər brifi (digest)** — app özü son sorğularını skan edir, ən vacib dəyişiklikləri
  səbəbi ilə bir bildirişdə toplayır (planlı + on-demand).
- **Smart insight bildirişləri** — saxlanan sorğu nəticələrindəki diqqətəlayiq dəyişikliklər.
- **Agentik Copilot (plan → təsdiq → icra)** — köməkçi əvvəl addım planı göstərir, sən
  təsdiqləyirsən, sonra icra edir. **24 alətlə platformanın HƏR funksiyasını çatdan idarə edir:**
  sorğu · dashboard qur/paylaş · **AutoML modeli öyrət/proqnoz** · **SWOT/Porter/BCG/BPMN** ·
  snapshot · qərar yaz/ölç · kəşf skanı · data
  müqaviləsi yoxla · **Digital Twin ssenarisi** · metrik/alert/sorğu yarat. Nəticə çipləri
  yaradılan obyekti birbaşa açır (`?open=` deep-link). Silmə əməliyyatları qəsdən çatdan kənardır;
  ağır alətlər (train/generate) alət başına 2/söhbət ilə məhdudlaşır.

### Ssenari & FP&A
- **KPI hədəf + pacing** — hədəfə çatma sürəti (tempo markeri ilə gauge).
- **Goal-seek** — "hədəfə çatmaq üçün neçə % lazımdır?".
- **Monte Carlo** — tarixi gəlirlərdən P10/P50/P90 qeyri-müəyyənlik diapazonu (determinik seed).
- **What-if ssenari** — metrikə % düzəliş → faktiki vs proqnoz.

### BA workflow
- **Tələbnamədən dashboard** — BRD / user story yapışdır və ya yüklə → AI ölçülə bilən
  KPI çıxarır → təsdiqlədikdən sonra tam dashboard qurur (tələb→KPI izlənilirlik).
- **BA Framework Studio** — bir kliklə **SWOT · Porter 5 qüvvə · BCG matrisi · BPMN proses
  xəritəsi** (AI-first + deterministik fallback; BCG nüvəsi tam deterministik — bazar payı =
  gəlir payı, artım H2-vs-H1, AI yalnız tövsiyə verir); BPMN mermaid diaqramı server-side
  **fail-closed sanitizer**-dən keçir. `/ba-studio` (SWOT 2×2 grid · Porter · BCG SVG · mermaid).

### Qərarlar & izləmə
- **Qərar İntellekti Döngüsü (closed-loop ROI)** — qərarı **ölçülə bilən metrikə bağla**,
  qərar anında **baseline** tutulur, real təsir **avtomatik ölçülür** (saxlanmış SQL-i AI-siz
  reexecute; cadence ilə planlı) və **proqnozla müqayisə** edilir (baseline→proqnoz→real +
  trayektoriya sparkline). **"Qərar dəqiqliyi"** istifadəçinin proqnozlarını reallıqla tutuşduraraq
  AI tövsiyələrini kalibrlər. (insight → action → outcome jurnalı + status izləmə üstündə qurulub.)
- **Alert-lər & monitorlar** — saxlanan sorğuya threshold bağla → şərt pozulanda bildiriş mərkəzi.
- **Workflow inteqrasiyaları** — brif/alert-ləri Slack · Teams · email-ə göndər (mock-first,
  config-gated); dashboard chat-də **@mention** → bildiriş.

### Data mənbələri & hazırlıq
- **Öz SQL bazanı qoş** — PostgreSQL / MySQL / SQLite (connection string, şifrəli saxlanılır).
- **CSV / Excel yüklə** — fayl avtomatik sorğulana bilən SQLite cədvəlinə çevrilir.
- **Data yenilə (replace-in-place)** — fayl mənbəsinə təzə CSV/Excel yüklə → **eyni datasource
  sətri** üzərinə yazılır (id qalır, sorğular/widget-lər/RLS bağlı qalır); köhnə engine evict olunur,
  schema/profile/query keşləri təmizlənir, sxem-itkisi xəbərdarlığı qaytarılır. `PATCH
  /datasource/{id}/data` (yalnız sqlite).
- **Bir kliklə Kəşf (One-click Explore)** — mənbədən **AI-siz** avtomatik X-ray dashboard:
  ölçü/kəsim/zaman sütunları guard-lu nümunədən təsnif olunur → KPI · zaman seriyası · top-N · say
  widget-ləri (≤8, eyni guard zənciri). `POST /datasource/{id}/explore` ("Kəşf et" düyməsi; Power BI
  istisna).
- **NL data-prep + çoxcədvəli join** — "orders ilə customers-i birləşdir, aylıq qrupla"
  → AI transform planı → önizləmə → yeni törəmə mənbə kimi saxla (SELECT-only guard).
- **Data profiling** — sütun üzrə null % · distinct · min/max · tip (nümunə əsaslı).
- **Schema browser + schema-bilən nümunə sorğular**.
- **Power BI inteqrasiyası** — NL→DAX (mock-first; real Azure AD ilə canlı executeQueries).
- **Demo mode** — real DB olmadan seeded SQLite üzərində işləyir.

### Semantik qat, etibar & dashboardlar
- **Metrik kataloqu (semantik qat)** — biznes metriklərini bir dəfə təyin et
  (ad, ifadə, sinonimlər); AI sorğularda tutarlı işlədir.
- **Etibar qatı** — metrikləri **sertifikatla** (verified badge + sahib), nəticə **lineage**-i,
  datasource **freshness SLA** (təzə / köhnəlib nişanı). "Tək həqiqət mənbəyi".
- **Cavab etibar nişanı (Trust Badge)** — hər cavabda pipeline-in artıq hesabladığı **güvən +
  mənşə** göstərilir: `llm` · `self_repaired` (DB xətasından təmir) · `deterministic_fallback`
  (offline rule-based) · `user_sql` (analitikin öz SQL-i). Sorğu və Tarixçə səhifələrində çip
  (`QueryLog.confidence`/`provenance`).
- **İnteraktiv dashboard** — widget-ləri sürüklə/ölç (react-grid-layout), auto-save,
  per-widget mənbə nişanı + yenilə, **cross-filter** (bir widget-də klik → bütün panel filtrlənir).
- **Canlı (real-time) dashboard** + **AI Data Story** (kinematik təqdimat) + **Copilot**.
- ⏳ **Zaman Maşını (dashboard snapshotları)** — dashboardın vəziyyəti snapshot kimi saxlanılır
  (əl ilə + canlı dashboardlar üçün scheduler-də saatlıq avtomatik; widget başına ≤200 sətir,
  50 snapshot retention); timeline üzrə keçmişə qayıt + indiki ilə müqayisədə **diff badge**-lər.
- **Biznes biliklər qrafı** — cədvəl · metrik · metrik-node · dashboard · widget · saxlanan
  sorğu · qərar · mənbə · sütun aktivlərinin interaktiv əlaqə xəritəsi (hand-rolled SVG force layout).
  **Analiz**: impact rejimi (aşağı / yuxarı / hər iki istiqamət BFS) + iki node arası **yol (path)**;
  **etibar qatı** (verified metrik + mənbə təzəliyi rəng halqaları); FK və sütun-səviyyə lineage.
  **Redaktə (yeni)**: sağ-klik ilə node/əlaqəni **görünüşdən çıxar** (real data silinmir), **0-dan
  xüsusi qraf yarat** və istənilən aktivi əlavə/çıxar — adlı görünüşlər hesabda saxlanılır
  (`graph_views`); alət paneli ikincili idarəetmələri bir "Seçimlər" menyusuna yığır. `/graph`.
- **Saxlanan sorğular + cədvəlli (cron) avto-yeniləmə** ("Hesabatlar").
- **Planlı PDF/Excel hesabat çatdırılması** — saxlanan sorğunu cədvəl üzrə (saatlıq/gündəlik/
  həftəlik) **email-ə PDF (reportlab) və ya Excel (openpyxl) əlavəsi** kimi göndər (mock-first,
  `INTEGRATIONS_LIVE` gated). BA-ların #1 paylama ehtiyacı.

### Komanda & idarəetmə (enterprise)
- **Workspace + rollar (RBAC)** — owner / editor / viewer; e-poçtla dəvət.
- **Row-level security (RLS) + mənbə kilidi** — üzv yalnız icazəli sətirləri görür (fail-closed;
  canlı + refresh yollarında tətbiq olunur). **Deny-by-default:** mənbəni bir kliklə "kilidlə" →
  qaydası olmayan üzv **heç bir sətir** görmür (sahibə təsir etmir). Yeni mənbələr kilidli yaradılır,
  mövcudlar olduğu kimi qalır.
- **Audit jurnalı** — təhlükəsizlik-əhəmiyyətli əməllərin izi (kim/nə/nə vaxt).

### Embed & white-label
- **Embedded analytics** — imzalı read-only embed token; iframe + yüngül `embed.js` SDK
  (auto-mount); söndürmə dərhal bütün tokenləri ləğv edir.
- **White-label brendinq** — ad · əsas rəng · loqo (embed görünüşünə tətbiq olunur).
- **Paylaşma** — tokenli read-only public dashboard linki + komanda chat.

### Hesab & platforma
- **Auth** — email/şifrə (JWT) + **Google Sign-In**; **refresh-token rotation**
  (reuse-detection + family-revoke) və `/auth/logout`.
- **Abunə planları + per-user rate limiting** — Free/Pro/Max/Max+ aylıq AI limiti;
  demo-da mock upgrade, prod-da **config-gated Stripe Checkout**.
- **LLM xərc nəzarəti** — hər completion token-cap-lidir; kvota sorğunun **real fan-out-una görə**
  yazılır (bir dashboard = 1 yox, ~19 çağırış); hər çağırışın USD dəyəri `ai_spend_daily`-yə düşür
  və gündəlik tavan (`AI_DAILY_USD_CEILING`) aşılanda AI dayanır. Tariflər təxminlə yox,
  **ölçmə ilə** qoyulub (`backend/scripts/measure_ai_cost.py`).
- **Qlobal semantik axtarış (⌘K)** — "churn-u harda izləyirik?" → dashboard/metrik/hesabat
  mənası ilə tapılır (embedding vektor store reuse, keyless offline fallback; komanda-paleti).
- **Claude-ilhamlı UI** — light/dark toggle, emerald accent, Source Serif 4 başlıqlar.
- **Performans** — Redis nəticə keşi (user-scoped), per-datasource connection pooling,
  **lazy chart bundle** (ağır recharts yalnız qrafik render olunanda yüklənir — ilk açılış yüngül).
- **Müşahidə** — Prometheus `/metrics`, struktur loglar.
- **RAG grounding** — keçmiş sorğular + verified metriklər portativ vektor store (SQLite+numpy)
  ilə Text2SQL generation prompt-una inject olunur (result-cache açarına yox); keyless offline (hash)
  fallback, hər NL→SQL cütü **index-on-write**. Bu, generation dəqiqliyini artırır.
- **Keyfiyyət darvazası** — backend pytest, frontend Vitest, **bloklayıcı Playwright E2E smoke** (CI).

### Qabaqcıl analitika & statistik etibar (differensiator)
Determinist statistik təməl (**scipy + numpy**; AutoML üçün **scikit-learn**) — saf riyaziyyat /
klassik ML, LLM yox:
- **Statistik mühafiz** — sorğu nəticəsinə etibar yoxlamaları (nümunə həcmi, dəyər yayılması,
  saxta korrelyasiya). `POST /query/{id}/significance` → ChartView "Statistik yoxlama" paneli.
- **Kauzal nəticə** — hədəf metriklə ən güclü əlaqəli sütunlar (Pearson r + p-dəyər + **BH-FDR**
  çox-müqayisə düzəlişi), dürüst caveat-larla. `POST /query/{id}/causal` → "Səbəb analizi" paneli.
- **Metrik ağacı (mənşəli)** — KPI dekompozisiyası (Gəlir = Qiymət × Həcm), dəyərlər aşağıdan-yuxarı
  toplanır + valideynə töhfə %. Hər yarpaq **mənşə** daşıyır: `measured` (saxlanan sorğunun son
  qaçışından ölçülüb — sum/avg/min/max/last/count, ölçmə vaxtı ilə), `manual` (əl ilə yazılmış
  **fərziyyə**, belə də etiketlənir), `unknown` (dəyər yoxdur). **Naməlum heç vaxt səssizcə 0 olmur** —
  yuxarı yayılır, çünki boş yarpağı sıfır saymaq `×` ağacında bütün KPI-nı sıfırlayır.
  `/metric-tree` · **Məlumat → Metrik ağacı**.
- **Data müqavilələri** — mənbə cədvəllərinə keyfiyyət zəmanəti (boş-deyil, unikal, diapazon,
  sxem-sabitliyi, təzəlik SLA); pozulmada bildiriş. `/contracts` · **Məlumat → Data müqavilələri**.
- **Digital Twin simulyatoru (3 səth: Model · Simulyator · Risk)** — metrik ağacının tam
  **client-side** "rəqəmsal əkizi" (`lib/metricTreeMath.ts` — backend `_combine` semantikasının dəqiq
  portu). **Model**: metrik ağacı redaktoru. **Simulyator**: KPI hero (count-up + delta + sparkline +
  P10–P90 qeyri-müəyyənlik zolağı), leaf ±% sliderlər, kumulyativ waterfall, ±10% tornado, goal-seek,
  ssenari müqayisəsi, KPI-hədəf pacing nişanı və "nə dəyişdi" driver narrativi. **Risk**:
  2000-iterasiyalı Monte Carlo (per-lever diapazon → P10/P50/P90 + histoqram). Simulyasiya riyaziyyatı
  tam client-side. **Dəyəri olmayan yarpağı olan KPI-da hər üç səth işləməkdən imtina edir** və
  əvəzində boş yarpaqları adbaad sayır — naməlum üzərində çəkilən şəlalə/tornado/histoqram real
  cavaba oxşayır, bu isə boş ekrandan pisdir. `/twin`.
- **AutoML Studiyası** — cədvəldən bir kliklə model öyrət (**scikit-learn**: Linear/LogReg vs
  RandomForest, holdout üzrə yaxşısı seçilir) + **dərin diaqnostika**: model reytinqi
  (leaderboard), **k-fold çarpaz yoxlama**, qarışıqlıq matrisi / faktiki-vs-proqnoz + qalıq
  histoqramı, permutasiya əhəmiyyəti və **per-proqnoz izahları** (orijinal sütun adı ilə).
  Datasource yolu `/query` ilə **eyni guard zəncirindən** keçir (cədvəl allowlist + per-viewer
  RLS); ≤5000 sətir öyrətmə, fit + diaqnostika ayrı thread-də. `/automl` wizard.

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
                                     │ ai/text2sql ← ai/retrieval (RAG grounding)  │
                                     │ ai/chart_selector·insight·forecast·anomaly  │
                                     │ ai/root_cause·requirements·data_prep·copilot│
                                     │ client.embed (vector)                       │
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

**Axın (`process_nl_query`):** rate-limit → **user-scoped** cache yoxla (açar **sabit**
metrik+söhbət kontekstindədir) → miss-də **RAG grounding** (`ai/retrieval` — bənzər keçmiş
sorğular + verified metriklər yalnız generation prompt-una; result-cache açarına yox) →
Text2SQL → SQL guard → pooled engine ilə icra → **RLS filtri** → chart + insight (paralel) →
QueryLog + cache + **index-on-write** (yeni NL→SQL cütü embed olunur) → QueryResult. On-demand
AI təhlilləri (`root-cause`, `forecast`, `anomaly`) və determinik hesablamalar
(`goal-seek`, `monte-carlo`, `lineage`, `profiling`) ayrıca endpoint-lərdir.

Ətraflı: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## Quick Start

```bash
# 1. Konfiqurasiya
cp .env.example .env
#   AI_API_KEY + AI_MODEL — AI mühərriki üçün (opsional; boşdursa tam offline demo işləyir)
#   SECRET_KEY:  python -c "import secrets; print(secrets.token_urlsafe(48))"
#   FERNET_KEY:  python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"

# 2a. Docker ilə hər şey (PostgreSQL + Redis + backend + frontend)
docker-compose up
```

> **Bu, dev stack-idir** — bind-mount, `--reload`, `DEMO_MODE=true`, TLS yoxdur.
> Real quraşdırma üçün **[docs/deploy.md](docs/deploy.md)**: `docker-compose.prod.yml`
> ilə demo-suz, çox worker-li, avtomatik HTTPS-li stack bir əmrlə qalxır.

### Docker olmadan (lokal dev)

```bash
# Backend
cd backend
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt   # test asılılıqları ayrıdır
alembic upgrade head
uvicorn app.main:app --reload --port 8000

# Frontend (yeni terminal)
cd frontend
npm install && npm run dev

# Redis (opsional, nəticə keşi üçün) — macOS:
brew install redis && brew services start redis
```

Aç: **http://localhost:5173**  ·  API docs: **http://localhost:8000/docs**

> Brauzerdə **`localhost`** işlət, `127.0.0.1` yox — CORS yalnız `localhost`-a icazə verir.

`DEMO_MODE` **default olaraq `false`-dur** — unudulmuş bir dəyişən demo qapılarını
production-a buraxmasın deyə. Yuxarıdakı `cp .env.example .env` onu lokal üçün açır;
`docker-compose.yml`-dəki dev stack isə özü açıq şəkildə verir.

Demo rejimində (`DEMO_MODE=true`) əlavə konfiqurasiya tələb olunmur — AI mühərriki
açarı boş olsa da tətbiq determinik offline rule-based mühərriklə işləyir; `DATABASE_URL`
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
| PATCH | `/api/v1/datasource/{id}/data` | Replace-in-place — təzə fayl yüklə, eyni datasource sətrini saxla (sqlite) |
| POST | `/api/v1/datasource/{id}/explore` | One-click Explore — AI-siz avtomatik X-ray dashboard (Power BI istisna) |
| GET/POST | `/api/v1/datasource/powerbi/datasets` · `/connect-powerbi` | Power BI dataset siyahısı · qoşulma |
| POST | `/api/v1/query/ask` | NL sorğu (+ `previous_query_log_id` follow-up) → QueryResult |
| POST | `/api/v1/query/run` | Power-user əl-SQL (AI-siz; SELECT-only + allowlist + RLS) → QueryResult |
| GET | `/api/v1/query/history` · `/{id}` | Tarixçə · saxlanmış nəticə |
| POST | `/api/v1/query/{id}/retry` · `/anomalies` · `/forecast` | Yenidən · anomaliya · proqnoz |
| POST/GET | `/api/v1/query/{id}/root-cause` · `/goal-seek` · `/monte-carlo` · `/lineage` | Kök-səbəb ağacı · goal-seek · Monte Carlo · mənşə |
| POST | `/api/v1/query/{id}/significance` · `/causal` | Statistik mühafiz (etibar yoxlamaları) · kauzal driver analizi (Pearson + BH-FDR) |
| POST/GET/PUT/DELETE | `/api/v1/dashboard/...` | Dashboard CRUD + widget (+ refresh / story / live) |
| POST/DELETE/PATCH | `/api/v1/dashboard/{id}/share` · `/embed` | Public token · imzalı embed token |
| GET | `/api/v1/public/dashboard/{token}` · `/public/embed/{token}` | Auth-suz read-only paylaşma · embed (brand-aware) |
| POST/GET/DELETE/PATCH | `/api/v1/metrics/...` (+ `/{id}/verify`) | Metrik CRUD + sertifikatlama |
| POST | `/api/v1/requirements/extract` · `/{id}/build` | BRD → KPI çıxar · dashboard qur |
| POST | `/api/v1/dataprep/preview` · `/materialize` | NL transform önizlə · mənbə kimi saxla |
| GET/POST/DELETE/PATCH | `/api/v1/datasource/{id}/profile` · `/rls` · `/sla` | Profiling · RLS qaydaları · freshness SLA |
| PATCH | `/api/v1/datasource/{id}/rls-mode` | Mənbəni kilidlə/aç (`strict`/`open`) — kilidlidə qaydasız üzv sıfır sətir görür |
| POST/GET/PUT/DELETE | `/api/v1/kpi-targets/...` | KPI hədəf + pacing |
| GET/POST/DELETE | `/api/v1/workspaces/...` (+ `/members`) · `/audit` | Workspace + RBAC üzvlük · audit jurnalı |
| GET/POST/DELETE | `/api/v1/integrations/...` (+ `/{id}/test`) | Slack/Teams/email kanalları |
| GET/PUT | `/api/v1/brand` | White-label brendinq |
| POST | `/api/v1/copilot/chat` (mode=plan/execute) | Agentik copilot (plan → icra) |
| POST/GET/DELETE | `/api/v1/saved/...` · `/alerts` · `/notifications` (+ `/digest`) | Saxlanan sorğular · monitorlar · brif |
| POST/GET/PUT/DELETE | `/api/v1/decisions/...` (+ `/{id}/measure` · `/roi` · `/trajectory` · `/accuracy`) | Qərar İntellekti Döngüsü — jurnal + metrik baseline/realized ölçmə · ROI · trayektoriya · dəqiqlik |
| GET/POST/PATCH/DELETE | `/api/v1/metric-tree/...` (+ `/evaluate` · `/bindable`) | Metrik ağacı — KPI dekompozisiya + roll-up + yarpaq mənşəsi; `/bindable` yarpağın bağlana biləcəyi saxlanan sorğuları və son qaçışın sütunlarını verir (sorğu İCRA ETMİR) |
| POST/GET/DELETE | `/api/v1/contracts/...` (+ `/{id}/run` · `/runs`) | Data müqavilələri — keyfiyyət/sxem/təzəlik yoxlaması |
| POST/GET/DELETE | `/api/v1/dashboard/{id}/snapshots` (+ `/{sid}`) | Zaman Maşını — snapshot çək · siyahı · bax · sil |
| PATCH | `/api/v1/dashboard/{id}/filter` | Qlobal dashboard filtri — tarix aralığı + dimension slicer, hər widget-in SQL-inə server-side WHERE kimi qatılır (RLS içində, data-only) |
| GET | `/api/v1/graph/` | Biznes biliklər qrafı — aktivlərin əlaqə xəritəsi (lineage reuse); `?columns=` sütun node-ları |
| GET/POST/PATCH/DELETE | `/api/v1/graph/views` (+ `/{id}`) | İstifadəçinin saxladığı xüsusi qraf görünüşləri (included/hidden id-lər) |
| POST/GET/DELETE | `/api/v1/ba/generate` · `/ba` · `/ba/{id}` | BA Framework Studio — SWOT/Porter/BCG/BPMN artefaktları (AI kvota) |
| GET/POST/DELETE | `/api/v1/automl/tables` · `/train` · `/models` (+ `/{id}/predict`) | AutoML — cədvəllər · model öyrət · siyahı · proqnoz · sil (per-IP limit) |
| GET/POST | `/api/v1/billing/plans` · `/usage` · `/upgrade` · `/checkout` | Planlar · istifadə · mock upgrade · Stripe (gated) |
| GET/POST | `/api/v1/search` · `/search/reindex` | Qlobal semantik axtarış (asset) · indeks yenilə |
| POST/GET/DELETE | `/api/v1/saved/{id}/subscriptions` | Planlı PDF/Excel hesabat çatdırılması (email) |
| GET | `/live` · `/ready` · `/health` · `/metrics` | Proses canlıdır (container HEALTHCHECK) · trafik qəbul edə bilər (DB + miqrasiya; uğursuzluqda 503) · `/live`-ın aliası · Prometheus metrikləri |

---

## Environment Variables

| Dəyişən | Təsvir |
|---------|--------|
| `AI_API_KEY` / `AI_MODEL` | AI mühərriki üçün giriş açarı + mühərrik identifikatoru (.env-dən; boşdursa offline rule-based) |
| `EMBEDDING_MODEL` | RAG embedding mühərriki (boşdursa determinik offline hash fallback) |
| `AI_MAX_TOKENS_JSON` / `_TEXT` / `_TOOLS` | Completion başına token tavanı (JSON cavab · sərbəst mətn · alət döngüsü) |
| `AI_PRICE_INPUT_USD_PER_1M` / `AI_PRICE_OUTPUT_USD_PER_1M` / `AI_PRICE_EMBEDDING_USD_PER_1M` | Modelin qiyməti — **0 qalsa hər çağırış $0 yazılır**, uçot sağlam görünür və tavan heç vaxt işə düşmür |
| `AI_DAILY_USD_CEILING` | Gündəlik USD tavanı (default 10). ⚠️ Yalnız **Postgres**-də etibarlıdır — SQLite-da sorğunun açıq tranzaksiyası uçotu bloklayır |
| `SCHEMA_LINK_TOP_K` / `_MIN_TABLES` / `_CACHE_TTL_SECONDS` | Geniş sxemdə modelə göndərilən cədvəl sayı · bu hədd və aşağısında linking keçilir · keş TTL |
| `RAG_ENABLED` / `RAG_TOP_K` / `RAG_MAX_CANDIDATES` / `RAG_HASH_DIM` / `RAG_INDEX_ON_WRITE` | RAG grounding: aktiv · inject olunan nümunə sayı · skan limiti · offline embed ölçüsü · hər NL→SQL-i indeksləmə |
| `GOOGLE_CLIENT_ID` | Google OAuth Web client ID (boşdursa düymə deaktiv) |
| `DATABASE_URL` | Async DSN (postgresql+asyncpg / sqlite+aiosqlite) |
| `REDIS_URL` / `CACHE_TTL_SECONDS` | Redis (opsional) · nəticə keşi TTL (default 300) |
| `DATASOURCE_POOL_SIZE` / `_MAX_OVERFLOW` / `_RECYCLE_SECONDS` / `DATASOURCE_MAX_ENGINES` | Datasource connection pool |
| `APP_DB_POOL_SIZE` / `_MAX_OVERFLOW` / `_RECYCLE_SECONDS` | Tətbiq DB-si üçün pool (non-sqlite) |
| `QUERY_TIMEOUT_SECONDS` / `SQLGEN_CACHE_TTL_SECONDS` | SQL icra timeout-u · NL→SQL generasiya keşi |
| `UPLOAD_DIR` / `UPLOAD_MAX_BYTES` | CSV/Excel yükləmə qovluğu · limit (10 MB) |
| `SCHEDULER_ENABLED` / `SCHEDULER_INTERVAL_SECONDS` / `SCHEDULER_REQUIRE_LOCK` | Saxlanan sorğu cədvəli · tick aralığı · **çox-worker kilidi** (default `true`: Redis yoxdursa dövrələr dayanır, çünki kilidsiz hər worker hesabatı bir dəfə göndərərdi) |
| `DIGEST_ENABLED` / `DIGEST_HOUR_UTC` / `DIGEST_MAX_ITEMS` | Proaktiv səhər brifi |
| `LIVE_REFRESH_ENABLED` / `LIVE_REFRESH_TICK_SECONDS` / `LIVE_DEMO_FEED` | Canlı dashboard |
| `REALTIME_BUS_ENABLED` | Çat/kursor/roster-i Redis üzərindən worker-lər arasında paylaş (default `false`; tək worker üçün lazımsızdır). Üzv çıxarılanda socket bağlama **həmişə** keçir |
| `COPILOT_MAX_STEPS` | Agentik copilot tool-loop limiti |
| `INTEGRATIONS_LIVE` / `SMTP_HOST·PORT·USERNAME·PASSWORD·FROM` | Slack/Teams/email (boşdursa mock) |
| `STRIPE_SECRET_KEY` / `STRIPE_SUCCESS_URL` / `STRIPE_CANCEL_URL` | Stripe Checkout (boşdursa gated/mock) |
| `POWERBI_TENANT_ID·CLIENT_ID·CLIENT_SECRET` / `POWERBI_API_BASE` / `POWERBI_MAX_ROWS` | Power BI (boşdursa mock provider) · REST baza · sətir cap |
| `SECRET_KEY` / `ACCESS_TOKEN_EXPIRE_MINUTES` / `REFRESH_TOKEN_EXPIRE_DAYS` | JWT açarı (prod ≥32) · access müddət (default 30 dəq) · refresh müddət |
| `METRICS_TOKEN` | `/metrics` üçün bearer (prod; demo-da loopback) |
| `MODEL_SIGNING_KEY` | Saxlanan AutoML modellərinin HMAC açarı. `SECRET_KEY`-dən ayrıdır ki, JWT açarını fırlatmaq bütün öyrədilmiş modelləri silməsin (boşdursa `SECRET_KEY`-ə düşür) |
| `FERNET_KEY` | Datasource & inteqrasiya sirlərinin şifrələnməsi (prod məcburi) |
| `DEMO_MODE` / `CORS_ORIGINS` | Demo SQLite (**default `false`**; prod-da açma) · icazəli origin-lər |

Frontend (`frontend/.env`): `VITE_API_URL`.

---

## Tests

```bash
cd backend && pytest        # 887 test (+1 skip: eval_llm, opt-in)
```
Əhatə: text2sql/SQL-guard & **SQL-hardening** (metadata denylist · schema allowlist · timeout) ·
query pipeline & user-scoped cache · dashboard (+refresh/share/embed) · auth & **refresh-token
rotation/reuse-detect** · rate-limit & tiers · datasource & CSV upload · anomaly/forecast ·
**root-cause · requirements→dashboard · NL data-prep & profiling · agentik copilot
(plan/execute) · trust (verified/lineage/SLA) · workspace RBAC + SQL-səviyyə RLS + audit · scenario
(goal-seek/Monte Carlo/pacing) · integrations (+ @mention) · embed/white-label/Stripe gate** ·
saved-query & scheduler · engine pool · metric catalog · chat context · alerts · decisions ·
**Qərar Döngüsü (baseline/measure/ROI/accuracy/impact-math/cascade) · RAG retrieval (user-scoped,
offline embed determinizmi, dedup)** ·
**qabaqcıl analitika: statistik mühafiz (t-test/z-test/Pearson/BH-FDR/MAD) · kauzal driver ·
metrik ağacı (roll-up) · data müqavilələri
(profiling-əsaslı keyfiyyət)** · **dashboard snapshotları
(test_snapshots) · biliklər qrafı (test_graph) · BA frameworks + mermaid sanitizer (test_ba) ·
AutoML guard zənciri + limitlər (test_automl) · LLM xərc uçotu + proporsional kvota
(test_ai_cost, test_usage_quota) · RLS deny-by-default: scope matrisi + uçdan-uca kilid
(test_rls_mode) · NL→SQL eval harness: 80 golden üçlük + qraderin öz testləri
(test_eval_nl2sql, test_eval_grader)** · təhlükəsizlik (pentest fixes). Testlər **hermetik** — `conftest`
`AI_API_KEY=""` qoyur (embed→hash, demo→rule-based; CI ilə eyni, real şəbəkə yox).

### NL→SQL dəqiqliyi ölçülür

`backend/tests/golden/nl2sql.jsonl` — 40 sual, az və en-də eyni cavabla, yəni 80 üçlük.
Qiymətləndirmə **nəticə-dəsti ekvivalentliyidir**, SQL sətir uyğunluğu yox: sütun adları,
sütun sırası və (sual sıra tələb etmirsə) sətir sırası sərbəst dəyişə bilər — bir sətirdə
hansı dəyərlərin yan-yana durduğu isə yox. `AI_API_KEY` testlərdə boş olduğu üçün ölçmə
hər PR-də **sıfır API xərcinə** offline mühərriki qiymətləndirir və `core` təbəqə üzrə
ratchet mərtəbəsi ilə **qapıdır**; real model istəyə bağlıdır
(`NEXUSBI_EVAL_LLM=1`, ~$0.22) və yalnız hesabatdır.

Ölçüldü 2026-08-02 (golden dəst dəyişəndən sonra **yenidən ölçüldü**, eyni rəqəm) —
`nl2sql_exact@1`:

| təbəqə | offline fallback | gpt-4o |
|---|---|---|
| core (qapı) | **1.00** (40/40) | **1.00** (40/40) |
| full | 0.00 (0/40) | 0.95 (38/40) |
| **ümumi** | **0.50** (40/80) | **0.97** (78/80) |
| az / en | 0.50 / 0.50 | 0.97 / 0.97 |

İki sütunun mənası budur: **modeli itirməyin qiyməti artıq rəqəmdir** — açar
yoxdursa, rate-limit dəyibsə və ya gündəlik tavan bağlanıbsa cavab keyfiyyəti
0.97 → 0.50 düşür, itkinin hamısı isə join/filtr/alt-sorğu tələb edən suallardadır.
Rəqəmin sərhədi: harness suala **RAG kontekstsiz** cavab verir (istehsalda
`prompt_context` da ötürülür), yəni bu **soyuq-start** ölçmədir — ölçmənin təkrar
oluna bilməsi üçün qəsdən belədir. Dizayn və yeni hal əlavə etmə qaydası:
`docs/superpowers/specs/2026-08-02-nl2sql-eval-design.md`.

**Frontend Vitest (749 test / 97 fayl):** lib (CSV formula-injection escape · sample queries · login hint ·
**color/contrast · notification kateqoriyaları · metricTreeMath (twin riyaziyyatı) · snapshotDiff**) ·
hook-lar (chart zoom · history delete · typewriter · force layout) ·
Zustand store reducer-ləri (live-update · query thread · copilot plan-guard · theme · notifications ·
collab epoch-guard · decision measure · **metric-tree ·
data-contract · snapshot · graph · twinStore · baStore · automlStore**) ·
**UI primitivləri (ModalShell a11y · ErrorBoundary · Dropdown · StatsGuard/Causal panel ·
BCGMatrix)**.
`cd frontend && npm run test`.

**E2E (Playwright):** `frontend/e2e/smoke.spec.ts` — login → NL sorğu (demo SQLite + rule-based
fallback) → dashboards. Lokal: `npm run test:e2e` (preview :4173; `E2E_BASE_URL` ilə dev :5173-ə yönəlt).

CI (`.github/workflows/ci.yml`) — 4 job: **backend** (ruff + pytest), **frontend** (Vitest + build),
**e2e** (demo backend qaldırılır → Playwright smoke; **bloklayıcı**, `needs: backend+frontend`) və
**deploy-smoke** (`docker-compose.prod.yml` + `scripts/deploy_smoke.sh` — prod stack-in yeganə icra
yeri). Əlavə iki workflow: `codeql.yml` (python + js/ts) və `secret-scan.yml` (gitleaks, tam tarixçə).
`main` ruleset-i beşini tələb edir: Backend · Frontend · E2E smoke · gitleaks · Deploy smoke.
Bundle analizi: `cd frontend && npm run analyze` → `stats.html`.

---

## Əlçatanlıq (qrafiklərin rəngi)

Dörd PR-lıq zəncir; hamısı **ölçülüb**, testlə kilidlənib (`charts/theme.test.ts`,
`charts/theme.contrast.test.ts`).

- **Mətn kontrastı** — chart etiketləri, ox başlıqları və `LabelList` `INK_SOFT`-dadır (WCAG AA:
  açıq 6.52–7.18, qaranlıq 5.94–7.21). Ox **xətti** ayrıca `AXIS` rəngindədir — o, 3:1 qrafika
  həddinə cavab verir, mətn həddinə yox, ona görə ikisi qəsdən fərqlidir.
- **Rejim üzrə palitra** — bütün chart rəngləri əvvəllər hər iki mövzuda paylaşılırdı və hamısı
  qaranlıq kətana köklənmişdi: açıq səthlərdə **20 rəngin 15-i** WCAG 1.4.11-in 3:1 həddindən
  aşağı düşürdü. İndi hər rejimin öz dəsti var.
- **Rəng korluğu** — əsl qüsur luminans boşluğu deyil, **dixromatiya altında birləşmə** idi
  (ən yaxın cüt: qaranlıqda ΔE 2.2, açıqda 5.2 — heç bir mövcud yoxlama bunu görmürdü).
  ⚠️ «Toqquşan iki hue-nu ayır» **işləmir**: dixromatiya hue-nu küyləmir, **oxu silir**.
  Palitra luminans boyunca yayıldı, hue-lar saxlanıldı.
- **Nə zəmanət verilir** — `theme.test.ts` bir qrafikin yan-yana qoya biləcəyi **hər cütü**
  (altı seriya + katlanmış pie-ın «Digər» dilimi) normal görmədə **və** hər üç dixromatiyada
  10 ΔE həddinə qarşı ölçür, üstəlik hər rəngi hər səthə 3:1-ə qarşı. Simulyator
  Viénot–Brettel–Mollon-dur; hər şərait öz **qarışıqlıq xətti** üzərində qurulmuş cütlə
  anchor-lanıb, yəni matrisin biri identity-yə çevrilsə test düşür.

⚠️ **Örtülməyən üç şey — bilərəkdən, ölçülmüş halda:**
1. **Boz-ton / monoxrom çap.** Hər dixromatiya modeli işıqlılığı **saxlayır**, ona görə o testlər
   boz-tonda birləşməni prinsipcə görə bilmir. Ən pis cüt **ΔL\* 0.4**.
2. **Trust-ring şiddəti** (`warn`/`danger`) kətanda yalnız hue ilə ayrılır — tritanopiyada **ΔE 6.6**.
   Halqanın *mövcudluğu* «ok deyil»i rəngsiz daşıyır; ayrıd edilməyən yalnız şiddətdir.
3. **Metrik CIE76-dır, CIEDE2000 deyil** — və CIE76 öz ən zəif cütünü tapmır (CIEDE2000-də
   5.37/5.34, CIE76 onlara 17.8/12.0 verir). Qazanc yenə real: köhnə palitra CIEDE2000-də 2.85/1.02.
   ⚠️ Tritan sütunu həm də **gamut kəsilməsindən** keçir (qaranlıq altı rəngdən dördü) — ona görə
   sıra belədir: **əvvəlcə tritan modeli (Brettel), sonra metrik, sonra palitra.**

`GRAPH_TYPE_COLORS` və `HEALTH_COLOR` bu hədə **qarşı ölçülmür** və bu qəsdəndir: doqquz düyün
tipinin hər birində per-tip ikon + sözlə yazılmış ad var, yəni rəng tək kanal deyil. Səbəb
`theme.ts`-də yazılıb ki, növbəti oxucu qoruyucunu genişləndirib **olmayan** bug-lar bildirməsin.

---

## Stack

**Backend:** FastAPI · SQLAlchemy 2.0 async · Pydantic v2 · Alembic · AI mühərriki (async client) ·
sqlglot (SQL guard/RLS) · JWT (python-jose) · Fernet · Redis · pandas/openpyxl/numpy/**scipy**
(statistik analitika) · **scikit-learn (AutoML)** · WebSockets (canlı/collab) · prometheus-client · structlog · google-auth · httpx
**Frontend:** React 18 · TypeScript · Vite · TailwindCSS (CSS-var light/dark) · Recharts (lazy) ·
**mermaid (lazy chunk, BPMN)** · react-grid-layout · Zustand · React Router · react-hot-toast · Vitest · Playwright (E2E)

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
- **Deny-by-default (`datasources.rls_mode`)** — `strict` mənbədə qaydası olmayan qeyri-sahib
  **sıfır sətir** görür (`rls_sql.deny_all_sql` sorğunu sarır ki, aqreqat da boş qayıtsın).
  Sahib yalnız **implisit** deny-dən azaddır — öz haqqında yazdığı qayda ona da tətbiq olunur.
  Kilidli mənbənin widget-ləri publik/embed linklərdə render olunmur (anonim baxışçının qaydası
  ola bilməz). Sıxılaşdırma `qcache:` və `profile:` keşlərini birdən təmizləyir.
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
- **AutoML pickle təhlükəsizliyi** — model blob-u yalnız serverin öz öyrətdiyi estimatordur;
  client-dən serialized bayt qəbul edilmir və blob heç bir API cavabında qaytarılmır.
- Connection string-lər və inteqrasiya sirləri **Fernet** ilə şifrəli; JWT bütün qorunan endpoint-lərdə.
- Prod-da `SECRET_KEY`/`FERNET_KEY` təyin olunmasa start fail edir; CORS Bearer-only.
- CSV upload validasiyası (tip/ölçü/ad sanitizasiyası); export-da formula-injection mühafizəsi.
- gitleaks + CodeQL + secret-scanning workflow-ları; `.env` və sirlər repo-ya commit olunmur.
