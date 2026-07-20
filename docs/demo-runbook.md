# NexusBI — Canlı Demo Runbook (kabin kartı)

Bir səhifəlik təqdimatçı kartı. Məqsəd: canlı demo **heç vaxt uğursuz olmasın**.

---

## 1. Başlatma

**Backend** (`backend/`):
```bash
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
alembic upgrade head            # sxemi qurur (təzə klonda vacibdir)
uvicorn app.main:app --reload --port 8000
```

**Frontend** (`frontend/`):
```bash
npm install && npm run dev      # → http://localhost:5173
```

> **Demo məzmunu avtomatik səpilir.** Təzə klonda (nexusbi.db yoxdur) `alembic upgrade head` + ilk `uvicorn` başlanğıcı demo hesabını **və** hər səhifə üçün məzmunu (dashboards, tarixçə, qərarlar, metriklər, biliklər qrafı, bildirişlər, komanda söhbəti, AutoML modeli) səpir. İlk başlanğıc bir neçə saniyə gec ola bilər — logda `demo_content_seeded` gözlə. **Demodan əvvəl bir dəfə başlat** ki, səpmə bitsin. Sonrakı başlanğıclarda təkrar səpilmir (idempotent).

---

## 2. Giriş

- URL: **http://localhost:5173** ⚠️ **`127.0.0.1` YOX** — CORS yalnız `localhost`-a icazə verir (əks halda boş login).
- Hesab: **demo@nexusbi.io** / **demo1234**

---

## 3. AI rejimi (tövsiyə: hər ikisi)

- **`.env`-də `AI_API_KEY` qoşulu olsun** → zəngin insight + agentic Copilot “24 alət, plan→icra” anı tam parlayır.
- **AMMA qızıl yolu həmişə hazır sual-çipləri (sample chips) ilə sür** — azad yazılan poetik sual (“Aylıq gəlir trendi necədir?”) offline rule-based motorda gözlənilməz ola bilər. Çip sxemə uyğun olduğuna görə **həmişə işləyir**. Beləliklə şəbəkə/açar qırılsa belə demo dayanmaz.
- Açarsız da tam işləyir (deterministik fallback) — bu, Slayd 5-in “açarsız işləyir” üstünlüyünü nümayiş etdirir.

---

## 4. Qızıl yol (canlı demo axını)

1. **Soruş** (`/`) → datasource “Demo” (avtomatik) → **hazır sual-çipinə klik** (məs. “kateqoriya üzrə gəlir”).
2. Nəticə kartında göstər: **generasiya olunan SQL → avtomatik qrafik → TrustBadge (confidence + provenance) → insight + stat-chip-lər**.
3. **Çox-turlu davam:** “bunu aya görə böl” → kontekst saxlanır (chat-with-data).
4. Həmin nəticədə **analiz panelləri** (ayrı səhifə açmadan): **Proqnoz** (confidence interval) → **“Niyə?”** root-cause ağacı.
5. **“Dashboard-a saxla”** və ya **“Qərara çevir”** — Slayd 10/11-ə körpü.
6. **Qısa breadth turu** (səpilmiş data ilə hamısı dolu): Dashboards → Biliklər qrafı → Digital Twin → Komanda söhbəti.

---

## 5. Canlı KLİKLƏMƏ (config-gated mock — seeded SQLite yolunda qal)

- **Power BI / NL→DAX** (Azure AD lazımdır → mock)
- **Slack / Teams / email / PDF çatdırılma** (`INTEGRATIONS_LIVE=false` → simulyasiya)
- **Stripe “Upgrade”** (ödəniş yoxdur → demo-only mock)
- **Google Sign-In** (konfiqurasiya yoxdursa düymə **gizlənir** — problem yox)

---

## 6. Canlı hərəkət lazımdırsa

- `LIVE_REFRESH_ENABLED=true` və `SCHEDULER_ENABLED=true` (default açıqdır) — yoxsa “Canlı rejim” dashboard-u və collab kursorları hərəkət etməz. Onları vəd etməzdən əvvəl yoxla.

---

## 7. Demodan əvvəl pre-warm (birdəfəlik)

- İlk qrafiki aç (Recharts lazy-load) · bir AutoML modelinə bax · bir BA Studio artefaktı yarat — ki canlı demoda ilk yükləmə gecikməsi olmasın.

---

## 8. Son yoxlama (demodan 5 dəqiqə əvvəl)

- [ ] Backend logda `demo_content_seeded` göründü
- [ ] `http://localhost:5173` (localhost!) açılır, demo hesabı ilə giriş olur
- [ ] Sidebar-dakı hər səhifə **dolu** görünür (boş yoxdur)
- [ ] `Soruş`-da sual-çipi işləyir → SQL + qrafik + insight çıxır
- [ ] Dil dəyişimi (AZ/EN/RU/TR) təmiz işləyir
