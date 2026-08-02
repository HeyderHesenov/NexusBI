# NexusBI-ı beş dəqiqəyə qur

Bu sənəd **real** quraşdırma üçündür — demo üçün deyil. Demo stack `docker-compose.yml`-dədir və `DEMO_MODE=true` ilə işləyir; aşağıdakı stack isə seed data-sız, çox worker-li və HTTPS-li qalxır.

## Tələblər

- Docker Engine 24+ və Compose v2
- 80 və 443 portları boş
- Domen üçün HTTPS istəyirsənsə: A/AAAA qeydi artıq bu hosta baxmalıdır (Let's Encrypt yoxlaması buna görə işləyir)
- ~4 GB RAM

## Quraşdırma

```bash
git clone https://github.com/HeyderHesenov/NexusBI.git
cd NexusBI
cp .env.prod.example .env.prod
```

`.env.prod`-u aç və **üç sirri** doldur — faylın özündə hər birinin necə yaradılacağı yazılıb:

```bash
openssl rand -base64 24                                                   # POSTGRES_PASSWORD
openssl rand -base64 48                                                   # SECRET_KEY
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"   # FERNET_KEY
```

HTTPS üçün `NEXUSBI_SITE_ADDRESS`-i domenin et (`bi.example.com`, sxemsiz) — Caddy sertifikatı özü alır və yeniləyir. Sonra:

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

Hazır olduğunu yoxla:

```bash
curl -f http://localhost/ready
```

## AI açarı olmadan işlətmək

`AI_API_KEY` **məcburi deyil.** Boş buraxsan NexusBI yenə qalxır: hər AI feature-i öz determinik qarşılığına düşür (Text2SQL qayda əsaslı, embedding hash əsaslı), heç bir model çağırışı edilmir, və `/ready` belə cavab verir:

```json
{"status":"ready","components":{"database":"ok","migrations":"ok","cache":"ok","ai":"degraded: no API key, deterministic fallbacks only"}}
```

Bu, xəta deyil — sənədləşdirilmiş iş rejimidir. Açar əlavə edib `docker compose -f docker-compose.prod.yml up -d` desən komponent `"ok"`-a keçir.

## AI xərc nəzarəti

Model çağırışları sənin açarınla gedir, yəni hesab sənə yazılır. Dörd açar bunu hədləyir (`.env.prod.example`-də hazır dəyərlərlə):

| Açar | Nə edir |
|---|---|
| `AI_PRICE_INPUT_USD_PER_1M` / `_OUTPUT_` / `_EMBEDDING_` | Token qiymətləri (engine-in qiymət səhifəsindən) |
| `AI_DAILY_USD_CEILING` | Gündəlik USD tavanı; `0` = söndürülüb |

Hər model çağırışı `ai_spend_daily` cədvəlinə yazılır — `(gün, feature, model)` üzrə bir sətir. Bugünkü cəm tavana çatanda AI **günün sonuna qədər** determinist yola keçir: məhsul işləməyə davam edir, sadəcə Text2SQL qayda əsaslı, embedding hash əsaslı olur. `/ready` bunu göstərir (503 vermir — tətbiq həqiqətən hazırdır):

```json
{"components":{"ai":"degraded: gündəlik büdcə bitdi ($10.14 / $10.00), yalnız determinist yol"}}
```

Tavan **UTC gecə yarısı** öz-özünə açılır; əl ilə sıfırlama yoxdur.

**Tələ:** tavanı qoyub qiymətləri `0` buraxsan hər çağırış 0 sayılır və tavan heç vaxt işə düşmür. Tətbiq bunu qalxarkən `ai_ceiling_without_prices` xəbərdarlığı ilə deyir — log-da onu görsən, qiymətləri qoy.

Prometheus tərəfində: `nexusbi_ai_cost_usd_total{feature=...}` (nəyin nə qədər xərclədiyi) və `nexusbi_ai_budget_remaining_usd` (tavana nə qalıb — alert qoymaq üçün doğru metrika budur).

**Yalnız PostgreSQL-də etibarlıdır.** SQLite bütün bazanı yazıcılar üçün kilidləyir, ona görə sorğu öz tranzaksiyasını açıq saxlayarkən (kvota vahidi götürülən andan etibarən — yəni hər AI endpoint-ində) uçot yazısı kilidə düşür və itir. Yuxarıdakı compose faylı Postgres işlədir, yəni real quraşdırma bundan təsirlənmir; amma `DEMO_MODE` ilə SQLite üzərində işlədirsənsə `ai_spend_daily` boş qalacaq və **gündəlik tavan işə düşməyəcək**. Bu halda yeganə qoruyucu engine tərəfindəki öz limitlərindir.

## Nə harda saxlanılır

Beş adlandırılmış volume var. Backup planı bunlardan ibarətdir:

| Volume | İçindəkilər | İtirilsə nə olur |
|---|---|---|
| `pgdata` | Bütün tətbiq datası | Hər şey gedir |
| `uploads` | Yüklənmiş fayllar, mənbə başına SQLite bazaları, AutoML imza açarı | Yüklənmiş mənbələr və öyrədilmiş modellər |
| `redisdata` | Leader lock, rate-limit sayğacları, keş | Heç nə kritik deyil — yenidən qurulur |
| `caddydata` | TLS sertifikatları və ACME hesabı | Sertifikatlar yenidən alınır (Let's Encrypt limitlərinə diqqət) |
| `caddyconfig` | Caddy avtomatik konfiqi | Heç nə |

Postgres backup-ı:

```bash
docker compose -f docker-compose.prod.yml exec -T db pg_dump -U nexusbi nexusbi | gzip > nexusbi-$(date +%F).sql.gz
```

## Arxitektura qərarları (niyə belədir)

**Miqrasiya ayrıca servisdədir, tətbiqin içində deyil.** Backend dörd worker ilə işləyir; miqrasiyanı lifespan-a qoysaq dörd proses eyni anda `alembic_version`-a yazmağa çalışardı. `migrate` servisi bir dəfə işləyir, backend isə onun **uğurla bitməsini** gözləyir (`service_completed_successfully`). Əlavə olaraq miqrasiyalar Postgres advisory lock altında işləyir — bu, compose-dan kənar hallar üçündür (əl ilə `alembic upgrade head`, k8s Job təkrarı).

**Yalnız `web` port açır.** Postgres və Redis compose şəbəkəsindən kənara çıxmır. Self-hosted quraşdırmanın brute-force yeyilməsi məhz açıq 5432-dən başlayır.

**Minimum PostgreSQL 12.** Compose `postgres:15` işlədir, amma öz idarə olunan bazana (RDS, Cloud SQL) bağlanırsansa bu həddi yoxla: `c6d7e8f9a0b1` miqrasiyası `ALTER TYPE ... ADD VALUE` işlədir, bu isə 12-dən əvvəlki versiyalarda tranzaksiya blokunun içində **rədd olunur** — alembic bütün qaçışı bir tranzaksiyada işlətdiyi üçün `alembic upgrade head` tamamilə düşər və `migrate` servisi sıfırdan fərqli kodla çıxar. Alternativ (`autocommit_block`) qəsdən seçilməyib: o, əhatə edən tranzaksiyanı commit edərdi və miqrasiya advisory lock-u (tranzaksiya-əhatəli) vaxtından əvvəl buraxılardı.

**Backend non-root işləyir** (uid 10001) və prod image-də test runner yoxdur.

**Frontend nisbi API ünvanı ilə build olunur** (`VITE_API_URL=/api/v1`). Bu o deməkdir ki, eyni image istənilən domendə işləyir və CORS ümumiyyətlə iştirak etmir.

**`REALTIME_BUS_ENABLED=true` və `SCHEDULER_REQUIRE_LOCK=true`.** Birincisi chat/presence-in worker-lər arasında keçməsini təmin edir; ikincisi Redis əlçatmaz olanda planlı işləri **dayandırır** — dörd worker-in eyni hesabatı dörd dəfə göndərməsindənsə heç göndərməməsi düzgündür.

## Doğrulama

Bu stack təsadüfən yox, ölçülərək doğrulanır. `scripts/deploy_smoke.sh` onu boş volume üzərində qaldırır və iddialarını bir-bir yoxlayır — demo rejimində olmadığını, miqrasiyanın xidmətdən əvvəl getdiyini, non-root işlədiyini, qeydiyyat→upload→sorğu axınının işlədiyini, WebSocket-in proxy-dən keçdiyini, dörd worker arasında **bir** scheduler lideri olduğunu, restart-dan sonra datanın sağ qaldığını, və baza öldürüləndə `/ready`-nin 503, `/live`-ın isə 200 qaytardığını.

CI-da `Deploy smoke (docker compose)` job-u kimi hər PR-də işləyir. Lokalda:

```bash
./scripts/deploy_smoke.sh
```

Öz compose layihəsi (`nexusbi-smoke`) və müvəqqəti env faylı ilə işləyir, ona görə eyni hostdakı real quraşdırmaya toxunmur.

## Yeniləmə

```bash
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

`migrate` servisi hər qalxışda yenidən işləyir və yeni miqrasiyaları tətbiq edir; yeni miqrasiya yoxdursa dərhal çıxır.

## Nasazlıq

| Simptom | Səbəb |
|---|---|
| `/ready` 503, `migrations: error` | `migrate` servisi uğursuz olub — `docker compose -f docker-compose.prod.yml logs migrate` |
| Konteyner qalxmır, log-da `SECRET_KEY must be set` | `.env.prod`-da `SECRET_KEY` boşdur və ya 32 simvoldan qısadır |
| Sertifikat alınmır | DNS hələ bu hosta baxmır, ya 80/443 bağlıdır, ya `NEXUSBI_SITE_ADDRESS` hələ `http://localhost`-dur |
| Böyük upload 413 ilə ölür | `NEXUSBI_MAX_BODY` backend-in `UPLOAD_MAX_BYTES`-ından kiçikdir |
| Chat/kursorlar işləmir | WebSocket upgrade proxy-dən keçmir — öz proxy-ni Caddy-nin qarşısına qoymusansa `Upgrade`/`Connection` başlıqlarını ötürməlidir |
