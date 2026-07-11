# NexusBI — Prezentasiya Danışıq Skripti

> Bu sənəd səni **NexusBI-ı başqalarına təqdim etməyə** hazırlayır. Onu bir dəfə baştan-sona oxu — sonra vizual prezentasiyanı (`presentation.html`) açıb hər bölmədə öz sözlərinlə danışa bilərsən.

## Necə istifadə etməli
- Aşağıdakı **15 “Slayd”** vizual prezentasiyadakı 15 bölmə ilə **eyni ardıcıllıqdadır**. Sən scroll edib slaydı göstərirsən, bu mətn isə həmin slaydda **nə deyəcəyini** deyir.
- Hər texniki söz **ilk dəfə keçəndə mötərizədə** izah olunub (məs. “KPI (Key Performance Indicator — əsas performans göstəricisi)”). Hamısı sondakı **Terminlər lüğəti**ndə də var — səhnədən əvvəl bir də oradan keçə bilərsən.
- Mətni əzbərləmə — **mənasını** tut, öz dilinlə de. Sonda **“Ola biləcək suallar”** bölməsi səni gözlənilməz suallara hazırlayır.

---

## Açılış (lift-pitch — 15 saniyəlik giriş)
> “Təsəvvür edin ki, datanızla adi dildə danışırsınız: ‘Bu il aylıq gəlir necə dəyişib?’ yazırsınız və dərhal düzgün SQL sorğusu, hazır qrafik və bir abzaslıq biznes izahı alırsınız — heç bir texniki bilik olmadan. Bax NexusBI bunu edir. Bu, süni intellektlə işləyən BI (Business Intelligence — biznes analitikası) platformasıdır: **sualdan dashboard-a**.”

---

## Slayd 1 — Başlıq: “Sualdan Dashboard-a”
**Nə deməli:**
NexusBI-ı bir cümlə ilə təqdim et: bu, **süni intellektlə işləyən BI (Business Intelligence — şirkətin datasını qərar üçün faydalı məlumata çevirən analitika) platformasıdır**. Şüarı — *“Sualı adi dildə yaz, cavabı gör.”* Dörd sözlə fərqi: **oflayn işləyir, deterministikdir, təhlükəsizdir (RLS ilə), və 4 dillidir.** Bu çipləri göstərib növbəti slayda keç.

> **İpucu:** “deterministik” sözünü ilk dəfə deyəndə qısaca aç: “yəni eyni sual həmişə eyni, təkrarlana bilən nəticəni verir — təsadüfi deyil.”

---

## Slayd 2 — NexusBI nədir? (dörd addımlı boru xətti)
**Nə deməli:**
NexusBI **natural-language-to-dashboard** (adi dildən dashboard-a) platformasıdır. İstifadəçinin yazdığı sual **dörd addımda** cavaba çevrilir:
1. **Adi dildə sual** — məs. “Aylıq gəlir trendi necədir?”
2. **Təhlükəsiz SQL (Structured Query Language — verilənlər bazasından məlumat çəkmək üçün standart dil)** — sistem yalnız oxuma (SELECT) sorğusu qurur; heç nə silinə/dəyişdirilə bilməz, üstəlik **RLS (Row-Level Security — sətir səviyyəsində təhlükəsizlik: hər istifadəçi yalnız icazəli sətirləri görür)** tətbiq olunur.
3. **Ən uyğun qrafik** — data tipinə görə avtomatik seçilir (xətt, sütun, dairə və s.).
4. **Biznes insight (mətn şəklində izah)** — əsas tapıntı, trend və tövsiyə.

Vurğula: “Bütün texniki mürəkkəblik gizlədilib — istifadəçi sadəcə sualını yazır.”

---

## Slayd 3 — Hansı problemi həll edir?
**Nə deməli:**
Klassik problem: biznes komandası hər sual üçün **SQL bilən analitikə** müraciət etməli olur. Nəticədə:
- **Darboğaz** — analitikin növbəsi uzanır;
- **Ləngimə** — sadə bir “niyə düşdü?” sualı günlərlə gözləyir;
- **Alət dağınıqlığı** — sorğu, qrafik, proqnoz, hesabat hamısı ayrı yerlərdə.

NexusBI bunu **self-serve** (özün-özünə xidmət — istifadəçi cavabı özü, dərhal alır) edir: sualı verən şəxs qrafiki və izahı da elə orada alır. Analitik boşalır, biznes sürətlənir.

---

## Slayd 4 — Kimlər üçün?
**Nə deməli:**
Dörd auditoriya:
- **Analitiklər** — sürətli kəşfiyyat, üstəlik istəsələr **xam SQL rejimi** ilə tam nəzarət;
- **Menecer və rəhbərlər** — SQL bilmədən öz suallarına dərhal cavab, dashboard və brif;
- **SQL power-user-lər (SQL-i yaxşı bilən peşəkarlar)** — kod redaktoru, schema (verilənlər bazasının cədvəl/sütun quruluşu) avtomatik tamamlama, hətta AI-nin qurduğu SQL-i redaktə etmək;
- **Komandalar və enterprise (böyük şirkətlər)** — **RBAC (Role-Based Access Control — rola görə giriş nəzarəti: kim nəyi görə/edə bilər)**, sətir səviyyəsində təhlükəsizlik, embed (dashboard-u başqa sayta yerləşdirmək) və white-label (öz brendinlə göstərmək).

---

## Slayd 5 — Üstünlüklər (fərqləndirici cəhətlər)
**Nə deməli:**
Səkkiz güclü tərəf — hərəsini bir cümlə ilə vur:
- **Oflayn / demo-first** — AI açarı olmadan da işləyir: **deterministik, qayda-əsaslı (rule-based) mühərrik** və seed (öncədən doldurulmuş) demo datası var.
- **Deterministik fallback (ehtiyat yol)** — Text2SQL (mətndən SQL-ə çevirmə), RAG, proqnoz, anomaliya — hamısının AI-siz işləyən yolu var; sistem heç vaxt “ilişmir”.
- **Etibar siqnalları** — hər cavabda **TrustBadge (etibar nişanı: əminlik + mənşə)**, metrik sertifikasiyası, **lineage (mənşə izi — nəticənin arxasındakı cədvəl/sütun/metriklər)**.
- **Deterministik statistik nüvə** — `scipy`/`numpy` kitabxanaları ilə səbəb analizi, **Monte Carlo (təsadüfi simulyasiya ilə ehtimal hesablama)**, metrik roll-up — LLM (Large Language Model — böyük dil modeli, yəni ChatGPT tipli AI) yox, real riyaziyyat.
- **RAG (Retrieval-Augmented Generation — AI-yə sənin öz schema/kontekstini “oxudub” cavabı ona əsaslandırmaq)** — daha dəqiq SQL.
- **Təhlükəsizlik** — yalnız-SELECT qoruması, fail-closed (şübhə olanda bağlayan) RLS, şifrələnmiş sirlər, imzalı embed.
- **Çoxdilli** — Azərbaycan, ingilis, rus, türk.
- **Self-host (öz serverində qurmaq) + Copilot (agentic köməkçi)** — `docker-compose` ilə öz infrastrukturunda; 24 alətli AI köməkçi.

---

## Slayd 6 — Texnologiya
**Nə deməli:**
Qısaca stack-i (texnologiya yığını) göstər ki, texniki auditoriya güvənsin:
- **Backend (server tərəfi):** FastAPI (Python-da sürətli async veb-freymvork), SQLAlchemy 2.0 (verilənlər bazası ilə işləmə), Alembic (schema miqrasiyaları — bazanın quruluş dəyişikliklərini idarə edir), `sqlglot` (SQL təhlükəsizlik yoxlaması), `scipy`/`scikit-learn` (statistika və maşın öyrənməsi).
- **Frontend (istifadəçi tərəfi):** React 18 + TypeScript, Vite, TailwindCSS, Recharts (qrafiklər), Zustand (state idarəetməsi).
- **Data mənbələri:** PostgreSQL, MySQL, SQLite, CSV/Excel yükləmə, **Power BI (Microsoft-un BI aləti; NexusBI ona NL→DAX çevirir)**.

> **DAX (Data Analysis Expressions)** — Power BI-ın öz sorğu dilidir; NexusBI adi dildəki sualı avtomatik DAX-a çevirir.

---

## Slayd 7 — Qlobal alətlər (hər səhifədə var)
**Nə deməli:**
İstifadəçini dörd daimi alətlə tanış et:
- **⌘K semantik axtarış** — dashboard, metrik, hesabatları **mənaya görə** tap (adı dəqiq bilməsən də).
- **Copilot köməkçi** — **agentic** (yəni özü plan qurub addım-addım icra edən) AI: plan qurur → sən təsdiqləyirsən → icra edir (24 alət).
- **Bildiriş mərkəzi** — alert (xəbərdarlıq) pozuntuları, smart-insight-lar və “Səhər brifi”.
- **Tema və dil** — işıq/qaranlıq və 4 dil arasında ani keçid.

---

## Slayd 8 — Bölmə 01: ANALİZ
**Nə deməli:**
Bu qrupda üç səhifə var:
- **Soruş (əsas konsol)** — adi dildə sual; **çox-turlu söhbət** (davam sualları verə bilirsən: “bunu aya görə böl”, “yalnız 2024”); **SQL power-user rejimi** (xam SQL yaz və ya AI-nin SQL-ini redaktə et); TrustBadge; insight + **stat-chip-lər (kiçik fakt nişanları: cəmi, dövr dəyişimi, anomaliyalar)**; nəticəni dashboard-a saxla və ya qərara çevir.
- **Tarixçə** — bütün keçmiş sorğuların jurnalı: axtar, qrafik tipinə görə süz, bir kliklə yenidən işlət.
- **AutoML (Automated Machine Learning — avtomatlaşdırılmış maşın öyrənməsi)** — cədvəl və hədəf sütun seçirsən, sistem özü **Linear/Logistic Regression və Random Forest** modellərini öyrədib müqayisə edir, ən yaxşısını seçir, dəqiqlik göstəricilərini (R², Accuracy, F1) və hər proqnoz üçün “əsas drayverləri” göstərir.

> Terminlər (AutoML): **Regression** — ədədi qiymət proqnozu (məs. satış məbləği); **Random Forest** — çox sayda qərar ağacının səsverməsi ilə işləyən model; **R²** — modelin dəyişkənliyi nə qədər izah etdiyi (1-ə yaxın = yaxşı); **Accuracy/F1** — təsnifat dəqiqliyi ölçüləri; **feature importance** — hansı sütunun nəticəyə ən çox təsir etdiyi.

---

## Slayd 9 — Bölmə 02: MƏLUMAT
**Nə deməli:**
Beş səhifə — datanın idarəsi:
- **Mənbələr** — Postgres/MySQL/SQLite qoşmaq, CSV/Excel yükləmək, Power BI. Hər mənbədə: **Explore (bir kliklə oflayn avto-dashboard)**, Schema, **Profil (hər sütunun boşluq faizi, unikal dəyər sayı, min-maks)**, RLS, yerində Refresh (datanı eyni mənbəyə yeniləmək), **freshness SLA (təzəlik zəmanəti — datanın nə vaxt köhnəldiyini bildirən müddət)**.
- **Metriklər** — biznes metriklərini **bir dəfə** təyin edirsən (ad, SQL ifadəsi, sinonimlər); AI onları hər yerdə eyni cür işlədir. **Certify (verified — təsdiqlənmiş nişan)** ilə etibarı artırırsan.
- **Biliklər qrafı** — bütün asset-lərin (mənbə → cədvəl → metrik → widget → dashboard → qərar) interaktiv qrafı. **Impact rejimi** — seçdiyin node-un bütün **downstream (ondan asılı, aşağı axın)** təsirlərini göstərir.
- **Data müqavilələri (data contracts)** — cədvəllər üçün keyfiyyət zəmanətləri: Not-null (boş olmasın), Unique (təkrarsız), Range (aralıqda), Schema (quruluş dəyişməsin), Freshness. “Yoxla” → Pass/Fail.
- **Tələblər** — **BRD (Business Requirements Document — biznes tələbləri sənədi)** yükləyirsən, sistem ölçüləbilən **KPI (Key Performance Indicator — əsas performans göstəricisi)**-ları çıxarır və onlardan tam dashboard qurur.

---

## Slayd 10 — Bölmə 03: VİZUALLAŞDIRMA
**Nə deməli:**
İki səhifə:
- **Dashboard-lar** — AI ilə qur, Explore, widget əlavə et/sürüklə. **Canlı rejim** (real-time avtomatik yenilənmə), **Zaman maşını (snapshot tarixçəsi — dashboard-un keçmiş vəziyyətlərini saxlayıb geri baxmaq)**, **Hekayə (slayd-təqdimat)**, **Komanda (canlı kursor + chat ilə birgə iş)**, Paylaş/Embed (white-label), **qlobal filtr + cross-filter (bir qrafikdə elementə klikləyəndə bütün digər qrafiklər süzülür)**.
- **Hesabatlar** — saxlanmış sorğular: bir kliklə yenidən işlət, **avtomatik cədvəl (schedule — saatlıq/günlük/həftəlik)**, **alert (xəbərdarlıq — statik hədd və ya z-score anomaliya pozulanda bildiriş)**, PDF/Excel çatdırılma (email-ə).

> **z-score** — bir dəyərin ortalamadan neçə standart kənarlaşma uzaqda olduğu; anomaliya aşkarında istifadə olunur.

---

## Slayd 11 — Bölmə 04: PLANLAMA
**Nə deməli:**
Dörd səhifə — analitikadan qərara körpü:
- **Qərarlar** — **Decision Loop (qərar dövrü: insight → hərəkət → nəticə)**. Qərarın **baseline (başlanğıc dəyər)**, **realized (real nəticə)** və **counterfactual (qərar verilməsəydi nə olardı proyeksiyası)** müqayisəsi; **qərar dəqiqliyi (kalibrasiya — proqnozların nə qədər doğru çıxdığı)**.
- **Hədəflər** — KPI hədəfləri + **pacing (temp izləmə)**: attainment % (nailolma faizi) və gözlənilən sürət (on-track / behind).
- **Digital Twin (rəqəmsal əkiz — biznesin riyazi modelini qurub “nə olarsa?” oynamaq)** — **metrik ağacı (KPI-ı komponentlərinə parçalamaq, məs. Gəlir = Qiymət × Say)** üzərində: Simulyasiya (levers/qolları ±% dəyiş), **Goal-seek (hədəfə çatmaq üçün hansı qolu nə qədər dəyişmək lazımdır)**, Müqayisə, **Monte Carlo (hər qola aralıq verib minlərlə təsadüfi ssenari → P10/median/P90 nəticə paylanması)**.
- **BA Studio (Business Analysis — biznes analizi çərçivələri)** — **SWOT (güclü/zəif tərəf, imkan/təhdid)**, **Porter 5 Qüvvə (bazar rəqabət analizi)**, **BCG matris (məhsul portfelini pay×artım üzrə qruplaşdırma)**, **BPMN (proses axını diaqramı)**.

> **P10/median/P90** — nəticələrin pis/orta/yaxşı ssenariləri (10%, 50%, 90% ehtimal həddi).

---

## Slayd 12 — Bölmə 05: İDARƏETMƏ
**Nə deməli:**
Dörd səhifə — komanda və inzibati işlər:
- **Komanda** — **workspace (iş sahəsi)** + RBAC: **owner/editor/viewer (sahib/redaktor/baxıcı)** rolları; **audit log (kim, nəyi, nə vaxt etdi — təhlükəsizlik jurnalı)**.
- **Brendinq** — embed dashboard-lar üçün **white-label** (ad, rəng, loqo) + AA-kontrast yoxlaması (əlçatanlıq üçün rəng kontrastı standartı).
- **Planlar** — abunə planları (Free/Pro/Max/Max+), aylıq AI-sorğu **kvotası**, istifadə.
- **Bildirişlər** — bildiriş mərkəzi + **“Səhər brifi” (digest — son dəyişiklikləri bir icmalda toplayan qısa hesabat)**.

---

## Slayd 13 — İstənilən nəticə üzərində: Analiz panelləri
**Nə deməli:**
Bu güclü tərəfi vurğula: hər sorğu nəticəsinə **ayrı səhifə açmadan, tək kliklə** dərin analizlər qoşulur:
- **Qrafik & Pivot** — 8 qrafik tipi + CSV, zoom, drill-down (dərinə klik). **Pivot (cross-tab — sətir/sütun/ölçü üzrə çarpaz cədvəl, Excel PivotTable kimi)**.
- **Proqnoz & Ssenari** — **Forecast (gələcək dəyər proqnozu, confidence interval — etibar aralığı ilə)** + goal-seek, Monte Carlo, what-if.
- **Diaqnostika** — **Anomaliyalar (IsolationForest — çoxölçülü kənarlaşma aşkarlayan model)**, **Səbəb analizi (Pearson korrelyasiya + BH-FDR)**, **Etibarlılıq yoxlaması (statistik guard — nümunə azdırsa və ya korrelyasiya saxtadırsa xəbərdarlıq)**, **Lineage**.
- **“Niyə?”** — çoxsəviyyəli **root-cause (kök səbəb) ağacı**: hansı drayver nə qədər töhfə verib.

> **Pearson korrelyasiya** — iki ədədi dəyişən arasında əlaqənin gücü (−1…+1); **p-value** — nəticənin təsadüfi olma ehtimalı (kiçik = etibarlı); **BH-FDR (Benjamini-Hochberg False Discovery Rate)** — çox sayda test edəndə “saxta kəşfləri” azaldan düzəliş.

---

## Slayd 14 — Təhlükəsizlik & etibar
**Nə deməli:**
“Fail-closed dizayn” — yəni şübhə olanda sistem **bağlayır, açmır**. Beş sütun:
- **Yalnız-SELECT SQL guard** — DML/DDL (dəyişdirən/silən əmrlər) və çox-ifadəli sorğular verilənlər bazasına çatmadan rədd olunur.
- **SQL-səviyyə RLS** — aqreqasiyadan (cəm/qruplaşdırmadan) **əvvəl** tətbiq olunur ki, total-lar sızmasın.
- **User-scoped cache (istifadəçiyə bağlı keş)** — nəticə keşi başqasına sızmır.
- **Şifrələnmə** — **Fernet (simmetrik şifrələmə)** ilə sirlər, **SSRF (Server-Side Request Forgery — serveri daxili ünvanlara sorğuya məcbur etmə hücumu) guard**, **JWT (JSON Web Token — giriş jetonu) refresh rotasiyası** (oğurlanma aşkarı ilə).
- **Provenance/mənşə** — TrustBadge, metrik sertifikasiyası, lineage, freshness SLA.

---

## Slayd 15 — Yekun / Demo
**Nə deməli:**
Güclü bağla: *“Sualını yaz — qalanını NexusBI edir.”* Rəqəmləri xatırlat: **17 funksional bölmə, 4 dil, 5 data mənbəyi tipi, demo rejimində limitsiz sorğu.** Sonra canlı demoya keç:
- URL: `http://localhost:5173`
- Email: `demo@nexusbi.io`
- Şifrə: `demo1234`

> **Demo mode** — AI açarı olmadan, seed datası ilə tam işləyən rejim; ideal ilk təəssürat üçün.

---

# Terminlər lüğəti (əlifba sırası)

- **Accuracy / F1** — təsnifat modelinin dəqiqlik ölçüləri; F1 balanssız datada daha etibarlıdır.
- **Agentic** — AI-nin özü plan qurub, addımları ardıcıl icra etməsi (sadəcə cavab yox).
- **Alert (xəbərdarlıq)** — bir şərt (hədd və ya anomaliya) pozulanda avtomatik bildiriş.
- **Anomaliya** — gözlənilən nümunədən kəskin kənarlaşan dəyər.
- **AutoML** — model seçimi/öyrətməsini avtomatlaşdıran maşın öyrənməsi.
- **Audit log** — kim, nəyi, nə vaxt etdiyini qeyd edən təhlükəsizlik jurnalı.
- **Baseline** — müqayisə üçün başlanğıc dəyər.
- **BA (Business Analysis)** — biznes analizi; SWOT, Porter, BCG kimi çərçivələr.
- **BCG matris** — məhsulları bazar payı × artım üzrə 4 kvadranta bölən model.
- **BH-FDR (Benjamini-Hochberg False Discovery Rate)** — çox test edəndə saxta kəşfləri azaldan statistik düzəliş.
- **BI (Business Intelligence)** — datanı qərar üçün faydalı məlumata çevirən analitika.
- **BPMN** — biznes proseslərini axın diaqramı ilə təsvir edən standart.
- **BRD (Business Requirements Document)** — layihənin biznes tələblərini yazan sənəd.
- **Cache (keş)** — təkrar sorğuları sürətləndirmək üçün nəticənin müvəqqəti saxlanması.
- **Confidence (əminlik)** — AI-nin cavaba nə qədər əmin olduğu (0–1).
- **Confidence interval (etibar aralığı)** — proqnozun ehtimal olunan diapazonu.
- **Confusion matrix** — təsnifatda doğru/yanlış proqnozların cədvəli.
- **Counterfactual** — “qərar verilməsəydi nə olardı” proyeksiyası.
- **Cross-filter** — bir qrafikdə seçim edəndə digər qrafiklərin də süzülməsi.
- **Cross-validation** — modeli datanın müxtəlif hissələrində sınaqdan keçirmə.
- **DAX (Data Analysis Expressions)** — Power BI-ın sorğu dili.
- **Dashboard** — bir neçə qrafik/göstəricini bir ekranda toplayan panel.
- **Data contract (data müqaviləsi)** — cədvəlin uyğun gəlməli olduğu keyfiyyət qaydaları.
- **Demo mode** — AI açarı olmadan, seed data ilə işləyən tam funksional rejim.
- **Deterministik** — eyni girişə həmişə eyni, təkrarlana bilən nəticə (təsadüfi deyil).
- **Dimension / Measure** — ölçü oxu (kateqoriya, məs. region) / ədədi göstərici (məs. gəlir).
- **Downstream** — seçilən elementdən asılı olan, aşağı axındakı asset-lər.
- **Drill-down** — ümumidən detala doğru dərinə enmək.
- **Embed** — dashboard-u başqa sayta/sistemə yerləşdirmək.
- **Embedding / Vektor store** — mətnin ədədi vektora çevrilib mənaya görə axtarıla bilməsi.
- **Fail-closed** — xəta/şübhə olanda girişi bağlayan (açan yox) təhlükəsizlik davranışı.
- **Feature importance** — hansı sütunun model nəticəsinə ən çox təsir etdiyi.
- **Fernet** — sadə, təhlükəsiz simmetrik şifrələmə üsulu.
- **Forecast (proqnoz)** — keçmiş dataya əsasən gələcək dəyərin təxmini.
- **Freshness SLA** — datanın nə vaxt “köhnə” sayılacağını təyin edən təzəlik zəmanəti.
- **Goal-seek** — verilən hədəfə çatmaq üçün lazım olan dəyişikliyi tapmaq.
- **IsolationForest** — çoxölçülü anomaliyaları aşkarlayan maşın öyrənmə modeli.
- **Insight** — nəticənin mətnlə izahı: əsas tapıntı, trend, tövsiyə.
- **JWT (JSON Web Token)** — istifadəçini identifikasiya edən imzalı giriş jetonu.
- **KPI (Key Performance Indicator)** — biznesin əsas performans göstəricisi (məs. aylıq gəlir).
- **Lineage (mənşə izi)** — nəticənin arxasındakı cədvəl/sütun/metriklərin izi.
- **LLM (Large Language Model)** — ChatGPT tipli böyük dil modeli.
- **Metrik ağacı** — KPI-ı komponentlərinə parçalayan iyerarxiya (Gəlir = Qiymət × Say).
- **Monte Carlo** — çoxlu təsadüfi ssenari ilə nəticə paylanmasını hesablama üsulu.
- **NL→SQL / Text2SQL** — adi dildəki sualı SQL sorğusuna çevirmə.
- **P10 / median / P90** — nəticələrin pis / orta / yaxşı ssenariləri (ehtimal həddləri).
- **Pearson korrelyasiya** — iki ədədi dəyişən arasında əlaqənin gücü (−1…+1).
- **Pivot / Cross-tab** — sətir/sütun/ölçü üzrə çarpaz cədvəl (Excel PivotTable kimi).
- **Power BI** — Microsoft-un BI aləti; NexusBI ona NL→DAX çevirir.
- **Provenance (mənşə)** — cavabın haradan gəldiyi: AI, deterministik, təmir edilmiş, və ya istifadəçi SQL-i.
- **p-value** — nəticənin təsadüfən yaranma ehtimalı; kiçik = daha etibarlı.
- **RAG (Retrieval-Augmented Generation)** — AI-yə öz kontekstini oxudub cavabı ona əsaslandırmaq.
- **Random Forest** — çox qərar ağacının səsverməsi ilə işləyən model.
- **RBAC (Role-Based Access Control)** — rola görə giriş nəzarəti (kim nəyi edə bilər).
- **Regression / Classification** — ədədi qiymət proqnozu / kateqoriya proqnozu.
- **Residual** — proqnozla real dəyər arasındakı fərq.
- **RLS (Row-Level Security)** — hər istifadəçinin yalnız icazəli sətirləri görməsi.
- **Roll-up** — aşağı səviyyəli dəyərləri yuxarıya doğru toplama.
- **R²** — regresiya modelinin dəyişkənliyi nə qədər izah etdiyi (1-ə yaxın = yaxşı).
- **Schema** — verilənlər bazasının cədvəl/sütun quruluşu.
- **Self-host** — proqramı öz serverində qurub işlətmək.
- **Self-serve** — istifadəçinin cavabı özü, aralıqçısız alması.
- **Snapshot / Time Machine** — dashboard-un keçmiş vəziyyətlərini saxlayıb geri baxmaq.
- **SLA (Service Level Agreement)** — xidmət/keyfiyyət səviyyəsi öhdəliyi.
- **SQL (Structured Query Language)** — verilənlər bazasından məlumat çəkmə dili.
- **SSRF (Server-Side Request Forgery)** — serveri daxili ünvanlara sorğuya məcbur edən hücum.
- **Stat-chip** — nəticənin kiçik fakt nişanları (cəmi, dövr dəyişimi, anomaliya).
- **SWOT** — güclü/zəif tərəf, imkan/təhdid analizi.
- **TrustBadge** — hər cavaba əminlik + mənşə göstərən etibar nişanı.
- **White-label** — məhsulu öz brendinlə (ad/rəng/loqo) göstərmək.
- **Widget** — dashboard-dakı tək qrafik/göstərici bloku.
- **Workspace** — komandanın asset-lərini qruplaşdıran iş sahəsi.
- **z-score** — dəyərin ortalamadan neçə standart kənarlaşma uzaqda olduğu.

---

# Ola biləcək suallar (Q&A — səhnəyə hazırlıq)

**S: AI açarı olmadan həqiqətən işləyir?**
C: Bəli. Açar olmayanda deterministik, qayda-əsaslı mühərrik SQL qurur, seed demo datası üzərində qrafik və insight verir. Bütün ağır analizlərin (proqnoz, anomaliya, səbəb) AI-siz statistik ehtiyat yolu var.

**S: Datam təhlükəsizdir? AI onu hara göndərir?**
C: Sorğular yalnız-SELECT qorumasından keçir (heç nə silinmir/dəyişmir), RLS aqreqasiyadan əvvəl tətbiq olunur, sirlər Fernet ilə şifrələnir, keş istifadəçiyə bağlıdır. Oflayn/self-host rejimində data serverindən çıxmır.

**S: Səhv SQL qurarsa nə olur?**
C: Sistem özü xətanı görüb sorğunu təmir etməyə çalışır (self-repair); mənşə “təmir edilmiş” kimi göstərilir. Hər cavabda TrustBadge əminliyi bildirir, istifadəçi SQL-i özü də redaktə edə bilər.

**S: Mövcud verilənlər bazama qoşula bilərəm, yoxsa yalnız CSV?**
C: Hər ikisi — PostgreSQL, MySQL, SQLite birbaşa; CSV/Excel yükləmə; həmçinin Power BI (NL→DAX). 

**S: ChatGPT-dən fərqi nədir?**
C: NexusBI ümumi çat deyil — sənin datana bağlı, təhlükəsiz (RLS), etibar siqnallı, deterministik ehtiyatlı tam BI platformasıdır: sorğudan dashboard, qərar, hesabat və proqnoza qədər.

**S: Böyük komanda üçün uyğundur?**
C: Bəli — workspace-lər, RBAC rolları, audit log, sətir-səviyyə təhlükəsizlik, embed və white-label enterprise üçün nəzərdə tutulub.
