# LLM xərc nəzarəti (Faza 1.4) — dizayn

**Tarix:** 2026-07-30
**Status:** Təsdiqlənib (istifadəçi), bölmə-bölmə. İcra planı ayrıca yazılacaq.

## Kontekst / problem

Yol xəritəsinin 1.4 bəndi. Hazırkı vəziyyət ölçülüb, dörd konkret boşluq var:

1. **`max_tokens` heç bir completion-da yoxdur.** `ai/client.py`-ın dörd giriş nöqtəsi
   (`chat_json`, `chat_text`, `chat_tools`, `embed`) modelə yuxarı hədd vermir — bir
   pozulmuş prompt cavabı model kontekstinin sonuna qədər uzana bilər.
2. **Kvota proporsional deyil.** `enforce_rate_limit` dependency-si HTTP sorğusuna
   **1 vahid** yazır (13 endpoint, 28 istinad). `/dashboard/generate` bir vahid sayılır,
   halbuki planlayıcı + hər sual üçün text2sql/chart/insight = onlarla model çağırışı edir.
3. **`usage_service.py:41` read-modify-write-dir** (`user.ai_calls_used += 1` → `flush`).
   Paralel sorğularda artımlar itir.
4. **USD anlayışı ümumiyyətlə yoxdur** — gündəlik tavan da, dövrə açarı da. Operatorun
   hesabını heç nə qorumur. (Sahib lokal `.env`-də `SCHEDULER_ENABLED=false` və
   `DIGEST_ENABLED=false` qoyub — məhz nəzarətsiz fon xərcinə görə.)

Mövcud və istifadə olunmayan imkan: **açarsız determinist yol**. `_require_configured()`
`AIGenerationError` atanda çağıranlar artıq `rule_based_sql` / hash-embedding fallback-ına
düşür. Dövrə açarı yeni fallback yazmaq əvəzinə məhz bu yolu işə salır.

## Təsdiqlənmiş qərarlar

| Sual | Qərar |
|---|---|
| Ölçü vahidi | İstifadəçiyə **sorğu** (proporsional), operatora **USD** (qeyd olunur) |
| Tavan dolanda | **Mövcud determinist yola keç** — məhsul işləməyə davam edir |
| Fon işləri | USD tavanına daxil, **aylıq kvotaya yox** (sorğunu istifadəçi etməyib) |
| Xərc anbarı | **Günlük aqreqat sətir**, `(gün, feature, model)` açarı ilə |
| Kvota aşımı | İcazə verilir; növbəti sorğu bloklanır |
| Tavan defoltu | `10.0` USD/gün (`0` = söndürülüb) |
| Tarif rəqəmləri | **Eyni işdə yenilənir**, ~60% brüt marja hədəfi ilə: 150 / 800 / 4000 / 6000 |

## Memarlıq

Bel sütunu: **`ai/client.py` onsuz da yeganə boğaz nöqtəsidir.** Dörd funksiyanın üçü
`_require_configured()` çağırır, dördü də `_record_call()` ilə bitir. Yeni qat qurulmur —
mövcud iki nöqtə genişlənir.

- **Çağırışdan əvvəl:** `_require_configured()` → `_preflight()`. Açar yoxlanışına dövrə
  açarının vəziyyəti əlavə olunur; açıqdırsa **eyni `AIGenerationError`** atılır.
  `embed()` öz açarsız yoxlamasını edir — ora da eyni şərt qoyulur ki, hash-embedding-ə düşsün.
- **Çağırışdan sonra:** `_record_call()` `resp.usage`-dən `prompt_tokens`/`completion_tokens`
  götürür, micro-USD hesablayır və iki yerə yazır — `ai_spend_daily` sətrinə və sorğu
  başına model-çağırış sayğacına (contextvar).

### Yeni komponentlər

| Komponent | Məsuliyyət |
|---|---|
| `app/billing/cost.py` | Token → micro-USD çevirmə, günlük cəmin oxunması/artırılması, dövrə açarının vəziyyəti |
| `app/models/ai_spend.py` + Alembic migrasiyası | `ai_spend_daily(day, feature, model)` → `calls`, `prompt_tokens`, `completion_tokens`, `micro_usd` |
| `app/ai/call_context.py` | Bir sorğu ərzindəki model çağırışlarını sayan contextvar — proporsional kvotanın mənbəyi |

`feature` ölçüsü **açıq parametrdir**: dörd client funksiyası `feature: str = "unknown"`
adlı keyword arqument alır və onu `_record_call`-a ötürür. Yığın izindən çıxarmaq kövrək
olardı. Bunun qiyməti odur ki, 12 AI modulunun çağırış yerləri redaktə olunmalıdır
(`text2sql`, `dashboard_planner`, `insight_digest`, …) — mexaniki, amma geniş diff.
Defolt `"unknown"` qalması qadağan deyil, sadəcə həmin xərc atributsuz görünür.

Pul **tam ədəd micro-USD** kimi saxlanılır (`1 USD = 1_000_000`), float yox — gündəlik
cəmin atomik `UPDATE` ilə artırılması və yuvarlaqlaşdırma sürüşməsinin olmaması üçün.

### Data axını (bir `/dashboard/generate`)

```
istək → enforce_rate_limit: pəncərə + kvota yoxlanır, 1 vahid tutulur
      → planner + N×(text2sql, chart, insight) model çağırışı
          hər biri: _preflight (açar? dövrə?) → model → _record_call
                    ├─ contextvar sayğacı += 1
                    └─ ai_spend_daily += micro_usd   (ayrı sessiya, öz commit-i)
      → cavab
      → finalizer: contextvar = 31 → kvotadan daha 30 vahid yazılır
```

**Xərc yazısı sorğunun tranzaksiyasından kənardadır** — ayrı qısaömürlü sessiya ilə öz
commit-ini edir. Səbəb: sorğu sonradan sınıb rollback olsa da pul artıq xərclənib, uçot
geri qayıtmamalıdır.

## Tətbiq semantikası

### Proporsional kvota
`enforce_rate_limit` `yield`-li dependency-yə çevrilir: əvvəldə pəncərə yoxlanır və 1 vahid
tutulur; `yield`-dən sonra contextvar sayğacına baxılıb qalan `N−1` vahid yazılır. Endpoint
istisna atsa belə finalizer işləyir — çağırışlar edilib, pulu ödənilib. Contextvar hər
sorğuda yenidən qurulur və finalizer-də sıfırlanır.

### Tarif rəqəmləri eyni işdə yenidən qurulur

Proporsionallıq vahidin mənasını dəyişir: bu gün 30 vahid = 30 HTTP sorğusu, ondan sonra
30 vahid = 30 **model çağırışı** ≈ bir dashboard generasiyası. Köhnə rəqəmlərlə Free
istifadəçisi ilk dashboard-da bloklanardı, ona görə iki dəyişiklik **eyni PR-da** getməlidir.

Biznes modeli (bunu açıq yazıram, çünki rəqəmlər ondan çıxır): **tək server-tərəfi açar**
var — operatorunki. İstifadəçilərin nə öz OpenAI hesabı, nə də ayrıca açarı olur; sorğu
backend-dən operatorun açarı ilə gedir, OpenAI ay sonu **cəmi** üçün operatora bir hesab
yazır. Kvota istifadəçinin ödədiyindən çox AI xərcləməsinin qarşısını alan yeganə
mexanizmdir — yəni birbaşa marja alətidir.

Hesablama bazası (2026-07-30 tarixli qiymətlər, `gpt-4o`: input **$2.50**/1M, output
**$10.00**/1M; embedding praktik olaraq sıfır). Prompt ölçülərindən çıxarılan **təxmin**:
bir model çağırışı ≈ **$0.01**, bir dashboard generasiyası ≈ 16–31 çağırış ≈ $0.11–0.20.

Hədəf: **~60% brüt marja** (AI xərci gəlirin ~40%-i) — sahibin qərarı, meyar isə "pul
ödəyən istifadəçi az istifadə edə bildiyini hiss etməsin".

| Tarif | Qiymət | İndi | **Yeni** | Təxmini AI xərci | Nə verir |
|---|---|---|---|---|---|
| Free | $0 | 30 | **150** | ~$1.50 | 5 dashboard və ya ~50 sorğu |
| Pro | $20 | 300 | **800** | ~$8 | ~26 dashboard |
| Max | $100 | 1500 | **4000** | ~$40 | ~130 dashboard |
| Max+ | $150 | 3000 | **6000** | ~$60 | ~195 dashboard |

`unlimited` (daxili demo/test tarifi) dəyişmir. `Tier.features` mətnləri də yenilənməlidir
(yalnız `billing/tiers.py`-dədir, frontend onları API-dən alır — i18n dublikatı yoxdur).
Max-ın `(5x)` etiketi düz qalır (4000/800); Max+-ın `(10x)` etiketi **artıq doğru deyil**
(6000/800 = 7.5x) və silinməlidir — sətir onsuz da "Ən yüksək limit" deyir.

**Marjanın nazikləşməsinin qiyməti — açıq yazılmalıdır.** 80% əvəzinə 60% seçmək təxmin
xətasına dözümü azaldır: əgər çağırış başına real xərc $0.01 yox $0.03 çıxarsa, Max tarifi
$100-lıq planda $120 xərcləyər, yəni zərər. Buna görə iki şey məcburi olur:
1. **Gündəlik USD tavanı yük daşıyan qoruyucudur**, "gözəl olardı" deyil — yeganə şey odur
   ki, təxmin yanılsa belə zərəri gündəlik məbləğlə hədləyir.
2. **İcradan ~bir həftə sonra `ai_spend_daily` üzərində ölçmə aparılmalı və rəqəmlər
   yenidən qoyulmalıdır.** Yuxarıdakı cədvəl təxminə əsaslanır, ölçməyə yox.

Free tarifi xalis xərcdir (gəlir yoxdur): 150 vahid × ~$0.01 = ayda ~$1.50 bir pulsuz
istifadəçiyə. 500 pulsuz istifadəçi = ayda ~$750 — miqyas artanda yenidən baxılmalı rəqəm.

### Kvota aşımı
1 vahidi qalan istifadəçi `/dashboard/generate` başladıb 31 vahid yandıra bilər; xərclənmiş
çağırışı geri qaytarmaq mümkün deyil. Aşımaya icazə verilir, növbəti sorğu bloklanır.
Alternativ (fan-out ortasında determinist yola keçmək) yarımçıq dashboard doğurur. Əsl
maliyyə qoruyucusu gündəlik USD tavanıdır.

### Atomiklik — iki fərqli sorğu, hər ikisi atomik
- **Ön yoxlama:** şərtli `UPDATE ... WHERE id = :id AND (pəncərə bitib OR ai_calls_used + 1 <= :quota)`;
  `rowcount == 0` → 429. Read-modify-write yoxdur, itirilmiş artım yoxdur, limitin üstünə keçmir.
- **Uzlaşdırma (`N−1`):** şərtsiz `UPDATE` — çağırışlar artıq baş verib.

Pəncərənin sıfırlanması eyni ifadənin içində `CASE`-lədir; SQL-də hər iki `CASE` sütunun
**köhnə** dəyərini görür, bizə lazım olan da odur. SQLite (dev/test) və Postgres (prod) —
hər ikisində işləyir.

### `max_tokens` və kəsilmə tələsi
Konfiqurasiya defoltları: `AI_MAX_TOKENS_JSON` (1500), `AI_MAX_TOKENS_TEXT` (800),
`AI_MAX_TOKENS_TOOLS` (1500); ehtiyacı olan çağıranlar parametrlə üstələyir.

**Vacib:** kəsilmə `chat_json`-un cavabını yararsız JSON edir və `json.loads` hazırda
tutulmur → 500. Ona görə `finish_reason == "length"` yoxlanır və `AIGenerationError` atılır
ki, determinist yola düşsün. `max_tokens`-i bu yoxlama olmadan əlavə etmək yeni nasazlıq gətirər.

### Tavan və qiymətləndirmə
`AI_DAILY_USD_CEILING` (defolt `10.0`, `0` = söndürülüb), `AI_PRICE_INPUT_USD_PER_1M` və
`AI_PRICE_OUTPUT_USD_PER_1M` (defolt `0`).

Tələ: tavan qoyulub, qiymət qoyulmayıbsa xərc həmişə sıfır sayılır və qoruma sükutla mövcud
olmur → başlanğıcda gur xəbərdarlıq loglanır (PR #11-dəki `ai_disabled_no_api_key` naxışı).

Günlük cəm proses daxilində ~15 saniyəlik TTL ilə keşlənir və hər yazıdan sonra dərhal
yenilənir. Çox-worker-li quraşdırmada aşım `worker × TTL pəncərəsindəki xərc` qədər ola
bilər — bu, təhlükəsizlik sərhədi yox, maliyyə yumşaq qoruyucusudur.

Açar UTC günü dəyişəndə öz-özünə qapanır; əl ilə sıfırlama yoxdur (Faza 4-ün admin konsolu).

## Xəta idarəsi

Qayda: **xərc uçotu heç vaxt istifadəçinin sorğusunu sındırmır.**

| Vəziyyət | Davranış |
|---|---|
| Dövrə açarı açıq | `_preflight` → `AIGenerationError` → determinist yol; `embed` → hash embedding |
| `finish_reason == "length"` | `AIGenerationError` (JSON çökməsi yox) |
| `ai_spend_daily` yazısı sınır | Sorğu davam edir, `ai_spend_write_failed` loglanır (tavan az sayır — sükutla sınmaqdan yaxşıdır) |
| Cavabda `usage` yoxdur | Token 0 sayılır, bir dəfə loglanır |
| Uzlaşdırma sınır | Cavab qaytarılır, loglanır |

## Müşahidə

Yeni səth qurulmur, mövcud üçü genişlənir:
- `core/metrics.py`: `nexusbi_ai_cost_usd_total` (Counter, `feature` etiketi) və
  `nexusbi_ai_budget_remaining_usd` (Gauge). Yanında artıq `ai_calls_total`/`ai_tokens_total` var.
- `core/health.py::_ai_status()` (PR #11, `/ready`-də **qapı olmayan** komponent):
  `budget_exhausted` və bugünkü xərc əlavə olunur.
- `ai_budget_exhausted` **bir dəfə** loglanır, hər çağırışda yox — `leader.py:48`-dəki
  `_no_redis_warned` naxışı ilə.

## Testlər

Qeyd: `usage_service` üçün hazırda **ayrıca test yoxdur** (yalnız `test_ai_chat.py` və
`test_architecture.py`-də dolayı toxunulur). Ardıcıllıq qaydasının tələb etdiyi "zəmanəti
pinləyən test" bu işlə qurulur.

`backend/tests/test_ai_cost.py` (yeni) + mövcudlara əlavə:

- Token → micro-USD çevrilməsi və yuvarlaqlaşdırma.
- **Atomiklik:** iki ayrı sessiyadan `asyncio.gather` ilə paralel `check_and_consume` →
  `ai_calls_used == 2` (bu, hazırkı kodda düşür).
- Pəncərənin `CASE` daxilində sıfırlanması.
- Proporsionallıq: bir sorğuda 3 saxta model çağırışı → 3 vahid yazılır.
- Dövrə açarı: xərc ≥ tavan → `chat_json` şəbəkəyə **çıxmadan** `AIGenerationError` atır;
  `embed` hash-ə düşür.
- `finish_reason == "length"` → `AIGenerationError`, `JSONDecodeError` yox.
- Tranzaksiya ayrılığı: sorğu sessiyası rollback olunur, `ai_spend_daily` sətri sağ qalır.
- **Arxitektura ratchet-i** (`test_architecture.py`-nin mövcud `_UNLIMITED_MUTATING_ROUTES`
  naxışı ilə): `chat.completions.create` çağırışı `max_tokens`-siz qala bilməz.

## Əhatədən kənar (qəsdən)

- İstifadəçi səviyyəsində faktura uçotu — Faza 3, Stripe ilə birlikdə. Günlük aqreqatın
  üstünə sonradan əlavə edilə bilər.
- Admin konsolunda əl ilə dövrə sıfırlaması — Faza 4.
- Model-spesifik qiymət cədvəli — hazırda tək model konfiqurasiya olunur.
- Frontend-in kvota göstəricisi (`/usage`) dəyişmir: vahid hələ də "sorğu"dur, sadəcə bir
  HTTP sorğusu birdən çox vahid yaza bilər.
- Ucuz modelə keçid (məsələn chart tipi seçimi kimi sadə təsnifat çağırışları üçün) —
  ən böyük xərc dəstəyidir, amma **əvvəlcə ölçmək lazımdır**. 1.4-dən sonrakı ilk namizəd.
- `Tier.features` mətnlərinin yalnız Azərbaycan dilində olması — mövcud i18n boşluğudur,
  bu işlə gəlmir və bu işdə həll olunmur.
