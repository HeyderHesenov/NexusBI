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
- ⌨️ **SQL power-user rejimi** — analitik təbii dil əvəzinə **öz SQL-ini yazır və ya
  AI-nin SQL-ini redaktə edib yenidən işlədir** (CodeMirror, sxem-bilən autocomplete).
  Tamamilə **AI-siz** (kvota yemir); eyni təhlükəsizlik zənciri (SELECT-only → cədvəl
  allowlist → RLS fail-closed). `POST /query/run`.
- 📊 **Avtomatik chart + əl ilə keçid** — bar · line · area · pie · scatter · cədvəl · **pivot**;
  CSV export, drill-down filtr (qrafik elementinə klik).
- 🔲 **Pivot cədvəl explorer** — nəticə üzərində sürüklə-seç çarpaz analiz (sətir/sütun/ölçü/
  aqreqat: cəm·orta·say·min·maks), SQL-siz — Excel PivotTable eqvivalenti, tam client-side.
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
  təsdiqləyirsən, sonra icra edir. **29 alətlə platformanın HƏR funksiyasını çatdan idarə edir:**
  sorğu · dashboard qur/paylaş · **AutoML modeli öyrət/proqnoz** · **SWOT/Porter/BCG/BPMN** ·
  kohort/funnel · snapshot · **A/B test yarat+analiz** · qərar yaz/ölç · kəşf skanı · data
  müqaviləsi yoxla · **Digital Twin ssenarisi** · metrik/alert/sorğu yarat. Nəticə çipləri
  yaradılan obyekti birbaşa açır (`?open=` deep-link). Silmə əməliyyatları qəsdən çatdan kənardır;
  ağır alətlər (train/generate) alət başına 2/söhbət ilə məhdudlaşır.

### Ssenari & FP&A
- 🎯 **KPI hədəf + pacing** — hədəfə çatma sürəti (tempo markeri ilə gauge).
- 🎯 **Goal-seek** — "hədəfə çatmaq üçün neçə % lazımdır?".
- 🎲 **Monte Carlo** — tarixi gəlirlərdən P10/P50/P90 qeyri-müəyyənlik diapazonu (determinik seed).
- 🎚️ **What-if ssenari** — metrikə % düzəliş → faktiki vs proqnoz.

### BA workflow
- 📝 **Tələbnamədən dashboard** — BRD / user story yapışdır və ya yüklə → AI ölçülə bilən
  KPI çıxarır → təsdiqlədikdən sonra tam dashboard qurur (tələb→KPI izlənilirlik).
- 🧰 **BA Framework Studio** — bir kliklə **SWOT · Porter 5 qüvvə · BCG matrisi · BPMN proses
  xəritəsi** (AI-first + deterministik fallback; BCG nüvəsi tam deterministik — bazar payı =
  gəlir payı, artım H2-vs-H1, AI yalnız tövsiyə verir); BPMN mermaid diaqramı server-side
  **fail-closed sanitizer**-dən keçir. `/ba-studio` (SWOT 2×2 grid · Porter · BCG SVG · mermaid).

### Qərarlar & izləmə
- 🎯 **Qərar İntellekti Döngüsü (closed-loop ROI)** — qərarı **ölçülə bilən metrikə bağla**,
  qərar anında **baseline** tutulur, real təsir **avtomatik ölçülür** (saxlanmış SQL-i AI-siz
  reexecute; cadence ilə planlı) və **proqnozla müqayisə** edilir (baseline→proqnoz→real +
  trayektoriya sparkline). **"Qərar dəqiqliyi"** istifadəçinin proqnozlarını reallıqla tutuşduraraq
  AI tövsiyələrini kalibrlər. (insight → action → outcome jurnalı + status izləmə üstündə qurulub.)
- 🔔 **Alert-lər & monitorlar** — saxlanan sorğuya threshold bağla → şərt pozulanda bildiriş mərkəzi.
- 🔌 **Workflow inteqrasiyaları** — brif/alert-ləri Slack · Teams · email-ə göndər (mock-first,
  config-gated); dashboard chat-də **@mention** → bildiriş.

### Data mənbələri & hazırlıq
- 🔌 **Öz SQL bazanı qoş** — PostgreSQL / MySQL / SQLite (connection string, şifrəli saxlanılır).
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
- ⏳ **Zaman Maşını (dashboard snapshotları)** — dashboardın vəziyyəti snapshot kimi saxlanılır
  (əl ilə + canlı dashboardlar üçün scheduler-də saatlıq avtomatik; widget başına ≤200 sətir,
  50 snapshot retention); timeline üzrə keçmişə qayıt + indiki ilə müqayisədə **diff badge**-lər.
- 🕸️ **Biznes biliklər qrafı** — cədvəl · metrik · metrik-node · dashboard · widget · saxlanan
  sorğu · qərar · mənbə aktivlərinin interaktiv əlaqə xəritəsi (hand-rolled SVG force layout);
  **impact rejimi** seçilən node-dan təsirlənənləri BFS ilə işıqlandırır. `/graph`.
- 🔖 **Saxlanan sorğular + cədvəlli (cron) avto-yeniləmə** ("Hesabatlar").
- 📧 **Planlı PDF/Excel hesabat çatdırılması** — saxlanan sorğunu cədvəl üzrə (saatlıq/gündəlik/
  həftəlik) **email-ə PDF (reportlab) və ya Excel (openpyxl) əlavəsi** kimi göndər (mock-first,
  `INTEGRATIONS_LIVE` gated). BA-ların #1 paylama ehtiyacı.

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
- 🔎 **Qlobal semantik axtarış (⌘K)** — "churn-u harda izləyirik?" → dashboard/metrik/hesabat
  mənası ilə tapılır (embedding vektor store reuse, keyless offline fallback; komanda-paleti).
- 🎨 **Claude-ilhamlı UI** — light/dark toggle, emerald accent, Source Serif 4 başlıqlar.
- ⚡ **Performans** — Redis nəticə keşi (user-scoped), per-datasource connection pooling,
  **lazy chart bundle** (ağır recharts yalnız qrafik render olunanda yüklənir — ilk açılış yüngül).
- 📈 **Müşahidə** — Prometheus `/metrics`, struktur loglar.
- 🧠 **AI-Engineering təməli (operator/dev aləti — "AI Keyfiyyət" səhifəsi)** — app öz Text2SQL
  AI-ının doğruluğunu ölçür:
  - **RAG grounding** — keçmiş sorğular + verified metriklər portativ vektor store (SQLite+numpy)
    ilə prompt-a inject olunur; keyless offline (hash) fallback.
  - **Səviyyələnmiş eval** — **execution-match** golden dəst (easy/medium/hard; JOIN/subquery/HAVING/
    ranking) **dəyər-əsaslı** müqayisə ilə (sütun adı yox, nəticə) — dürüst rəqəm + per-tier + per-case.
  - **Bare vs grounded** — RAG-ın real töhfəsini (delta) izolyasiya edir.
  - **Tarixçə reqressiyası** — istifadəçinin saxladığı/dashboard sorğularında **AI drift**-i ölçür
    (data dəyişikliyindən təcrid: eyni snapshot-da köhnə vs yeni SQL).
  - **CI gate + alert** — determinist rule-based floor (CI-da reqressiya tutur) + dəqiqlik düşəndə
    bildiriş; LLM observability (latency/token/RAG hit-rate). Demo məhdudiyyəti UI-da açıq etiketlənir.
- ✅ **Keyfiyyət darvazası** — backend pytest, frontend Vitest, **bloklayıcı Playwright E2E smoke** (CI).

### Qabaqcıl analitika & statistik etibar (differensiator)
Determinist statistik təməl (**scipy + numpy**; AutoML üçün **scikit-learn**) — saf riyaziyyat /
klassik ML, LLM yox:
- 🛡️ **Statistik mühafiz** — sorğu nəticəsinə etibar yoxlamaları (nümunə həcmi, dəyər yayılması,
  saxta korrelyasiya). `POST /query/{id}/significance` → ChartView "Statistik yoxlama" paneli.
- 🔗 **Kauzal nəticə** — hədəf metriklə ən güclü əlaqəli sütunlar (Pearson r + p-dəyər + **BH-FDR**
  çox-müqayisə düzəlişi), dürüst caveat-larla. `POST /query/{id}/causal` → "Səbəb analizi" paneli.
- 🧪 **A/B testlər** — iki variant (konversiya nisbəti və ya orta) statistik əhəmiyyət + lift +
  95% CI + qalib verdikti. `/experiments` · **Planlama → A/B testlər**.
- 🔍 **Insight mühərriki** — son nəticələri avtomatik tarayır (dominantlıq, konsentrasiya, MAD-əsaslı
  anomaliya), **təsirə görə** sıralayır, dedup edir. `/insights` · **Analiz → Kəşflər**.
- 🌳 **Metrik ağacı** — KPI dekompozisiyası (Gəlir = Qiymət × Həcm), dəyərlər aşağıdan-yuxarı
  toplanır + valideynə töhfə %. `/metric-tree` · **Məlumat → Metrik ağacı**.
- 📋 **Data müqavilələri** — mənbə cədvəllərinə keyfiyyət zəmanəti (boş-deyil, unikal, diapazon,
  sxem-sabitliyi, təzəlik SLA); pozulmada bildiriş. `/contracts` · **Məlumat → Data müqavilələri**.
- 📈 **Kohort & Funnel analitikası** — retention heatmap (kohort × həftə) + visit→signup→trial→
  purchase konversiya hunisi (demo `events` cədvəli üzərində, determinist SQL). `/cohort`
  (CohortHeatmap + FunnelChart, hand-rolled SVG).
- 🎛️ **Digital Twin simulyatoru** — metrik ağacının tam **client-side** "rəqəmsal əkizi"
  (`lib/metricTreeMath.ts` — backend `_combine` semantikasının dəqiq portu): leaf-lərə ±% slider,
  kumulyativ-ardıcıl waterfall, ±10% tornado həssaslıq analizi; ssenarilər lokal saxlanılır
  (backend dəyişikliyi yox). `/twin`.
- 🤖 **AutoML Studiyası** — cədvəldən bir kliklə model öyrət (**scikit-learn**: Linear/LogReg vs
  RandomForest, holdout üzrə yaxşısı seçilir), feature əhəmiyyəti + interaktiv proqnoz;
  datasource yolu `/query` ilə **eyni guard zəncirindən** keçir (cədvəl allowlist + per-viewer
  RLS); ≤5000 sətir öyrətmə, fit ayrı thread-də. `/automl` wizard.

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
                                     │ ai/eval (golden-set) · client.embed (vector)│
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
AI təhlilləri (`root-cause`, `forecast`, `anomaly`, `explain`) və determinik hesablamalar
(`goal-seek`, `monte-carlo`, `lineage`, `profiling`) ayrıca endpoint-lərdir; **Text2SQL
keyfiyyəti** golden-set eval + AI observability ilə ölçülür (`/ai/eval`, `/ai/observability`).

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
| POST | `/api/v1/query/ask` | NL sorğu (+ `previous_query_log_id` follow-up) → QueryResult |
| POST | `/api/v1/query/run` | Power-user əl-SQL (AI-siz; SELECT-only + allowlist + RLS) → QueryResult |
| GET | `/api/v1/query/history` · `/{id}` | Tarixçə · saxlanmış nəticə |
| POST | `/api/v1/query/{id}/retry` · `/anomalies` · `/forecast` · `/explain` | Yenidən · anomaliya · proqnoz · kök-səbəb |
| POST/GET | `/api/v1/query/{id}/root-cause` · `/goal-seek` · `/monte-carlo` · `/lineage` | Kök-səbəb ağacı · goal-seek · Monte Carlo · mənşə |
| POST | `/api/v1/query/{id}/significance` · `/causal` | Statistik mühafiz (etibar yoxlamaları) · kauzal driver analizi (Pearson + BH-FDR) |
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
| POST/GET/PUT/DELETE | `/api/v1/decisions/...` (+ `/{id}/measure` · `/roi` · `/trajectory` · `/accuracy`) | Qərar İntellekti Döngüsü — jurnal + metrik baseline/realized ölçmə · ROI · trayektoriya · dəqiqlik |
| POST/GET | `/api/v1/ai/eval/run` (`?grounded`) · `/eval/history-regression` · `/eval/runs` · `/observability` · `/retrieval/reindex` | Text2SQL golden-set eval (bare/grounded) · saxlanmış sorğularda AI drift · tarixçə · AI müşahidə · RAG reindex |
| POST/GET/DELETE | `/api/v1/experiments/...` (+ `/{id}/analyze`) | A/B testlər — konversiya/orta əhəmiyyət + lift + 95% CI |
| GET/POST | `/api/v1/insights/...` (+ `/generate` · `/{id}/dismiss`) | Insight mühərriki — avtomatik kəşf + təsir reytinqi |
| GET/POST/PATCH/DELETE | `/api/v1/metric-tree/...` (+ `/evaluate`) | Metrik ağacı — KPI dekompozisiya + roll-up |
| POST/GET/DELETE | `/api/v1/contracts/...` (+ `/{id}/run` · `/runs`) | Data müqavilələri — keyfiyyət/sxem/təzəlik yoxlaması |
| GET | `/api/v1/cohort/retention` · `/funnel` | Kohort retention heatmap · konversiya hunisi (demo `events`) |
| POST/GET/DELETE | `/api/v1/dashboard/{id}/snapshots` (+ `/{sid}`) | Zaman Maşını — snapshot çək · siyahı · bax · sil |
| PATCH | `/api/v1/dashboard/{id}/filter` | Qlobal dashboard filtri — tarix aralığı + dimension slicer, hər widget-in SQL-inə server-side WHERE kimi qatılır (RLS içində, data-only) |
| GET | `/api/v1/graph` | Biznes biliklər qrafı — aktivlərin əlaqə xəritəsi (lineage reuse) |
| POST/GET/DELETE | `/api/v1/ba/generate` · `/ba` · `/ba/{id}` | BA Framework Studio — SWOT/Porter/BCG/BPMN artefaktları (AI kvota) |
| GET/POST/DELETE | `/api/v1/automl/tables` · `/train` · `/models` (+ `/{id}/predict`) | AutoML — cədvəllər · model öyrət · siyahı · proqnoz · sil (per-IP limit) |
| GET/POST | `/api/v1/billing/plans` · `/usage` · `/upgrade` · `/checkout` | Planlar · istifadə · mock upgrade · Stripe (gated) |
| GET/POST | `/api/v1/search` · `/search/reindex` | Qlobal semantik axtarış (asset) · indeks yenilə |
| POST/GET/DELETE | `/api/v1/saved/{id}/subscriptions` | Planlı PDF/Excel hesabat çatdırılması (email) |
| GET | `/health` · `/metrics` | Sağlamlıq · Prometheus metrikləri |

---

## Environment Variables

| Dəyişən | Təsvir |
|---------|--------|
| `AI_API_KEY` / `AI_MODEL` | AI mühərriki üçün giriş açarı + mühərrik identifikatoru (.env-dən; boşdursa offline rule-based) |
| `EMBEDDING_MODEL` | RAG embedding mühərriki (boşdursa determinik offline hash fallback) |
| `RAG_ENABLED` / `RAG_TOP_K` / `RAG_MAX_CANDIDATES` / `RAG_HASH_DIM` / `RAG_INDEX_ON_WRITE` | RAG grounding: aktiv · inject olunan nümunə sayı · skan limiti · offline embed ölçüsü · hər NL→SQL-i indeksləmə |
| `AI_TRACE_ENABLED` / `EVAL_MIN_ACCURACY` | AI çağırış izi (token/latency müşahidə) · eval "aşağı hədd" işarəsi |
| `EVAL_RULE_BASED_FLOOR` / `EVAL_ALERT_THRESHOLD` | CI gate: determinist rule-based eval floor (default 0.25) · dəqiqlik bu həddən aşağı düşəndə alert (default 0.7) |
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
cd backend && pytest        # 420 test
```
Əhatə: text2sql/SQL-guard & **SQL-hardening** (metadata denylist · schema allowlist · timeout) ·
query pipeline & user-scoped cache · dashboard (+refresh/share/embed) · auth & **refresh-token
rotation/reuse-detect** · rate-limit & tiers · datasource & CSV upload · anomaly/forecast/explain ·
**root-cause · requirements→dashboard · NL data-prep & profiling · agentik copilot
(plan/execute) · trust (verified/lineage/SLA) · workspace RBAC + SQL-səviyyə RLS + audit · scenario
(goal-seek/Monte Carlo/pacing) · integrations (+ @mention) · embed/white-label/Stripe gate** ·
saved-query & scheduler · engine pool · metric catalog · chat context · alerts · decisions ·
**Qərar Döngüsü (baseline/measure/ROI/accuracy/impact-math/cascade) · RAG retrieval (user-scoped,
offline embed determinizmi, dedup) · Text2SQL eval (dəyər-əsaslı execution-match, golden health,
rule-based CI floor, bare/grounded) · tarixçə-reqressiyası (drift) · eval alert** ·
**qabaqcıl analitika: statistik mühafiz (t-test/z-test/Pearson/BH-FDR/MAD) · kauzal driver ·
A/B əhəmiyyət · insight mühərriki (kəşf+reytinq) · metrik ağacı (roll-up) · data müqavilələri
(profiling-əsaslı keyfiyyət)** · **kohort/funnel (test_cohort) · dashboard snapshotları
(test_snapshots) · biliklər qrafı (test_graph) · BA frameworks + mermaid sanitizer (test_ba) ·
AutoML guard zənciri + limitlər (test_automl)** · təhlükəsizlik (pentest fixes). Testlər **hermetik** — `conftest`
`AI_API_KEY=""` qoyur (embed→hash, demo→rule-based; CI ilə eyni, real şəbəkə yox).

**Frontend Vitest (202 test):** lib (CSV formula-injection escape · sample queries · login hint ·
**color/contrast · notification kateqoriyaları · metricTreeMath (twin riyaziyyatı) · snapshotDiff**) ·
hook-lar (chart zoom · history delete · typewriter · force layout) ·
Zustand store reducer-ləri (live-update · query thread · copilot plan-guard · theme · notifications ·
collab epoch-guard · decision measure · AI-quality eval · **experiment · insight · metric-tree ·
data-contract · cohort · snapshot · graph · twinStore · baStore · automlStore**) ·
**UI primitivləri (ModalShell a11y · ErrorBoundary · Dropdown · StatsGuard/Causal panel ·
CohortHeatmap/FunnelChart · BCGMatrix)**.
`cd frontend && npm run test`.

**E2E (Playwright):** `frontend/e2e/smoke.spec.ts` — login → NL sorğu (demo SQLite + rule-based
fallback) → dashboards. Lokal: `npm run test:e2e` (preview :4173; `E2E_BASE_URL` ilə dev :5173-ə yönəlt).

CI (`.github/workflows/ci.yml`) — 3 job: **backend** (ruff + pytest), **frontend** (Vitest + build),
**e2e** (demo backend qaldırılır → Playwright smoke; **bloklayıcı**, `needs: backend+frontend`).
Bundle analizi: `cd frontend && npm run analyze` → `stats.html`.

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
