# Supabase veri katmanı

Proje: `rmisfrxsnhdpcxqzmicy`. İstemci anon key ile (`client/src/lib/supabase.js`),
sunucu kullanıcı JWT'si ya da service role ile (`api/_lib/auth.js`) bağlanır.
Canlı `public` şemasında yalnız hesap tabloları vardır; 13F verisi Supabase'de
**değildir**.

## 1. Veri nerede duruyor (S1)

Her veri seti GitHub Actions'ın ürettiği ve deployment branch'ine commit'lediği
bir JSON dosyasıdır. Vercel bu dosyaları fonksiyon paketine alır
(`vercel.json` → `includeFiles`) ya da `client/public` üzerinden CDN'den sunar.
Blob, KV, Actions artifact ya da Supabase kullanılmaz.

| Üretici | Çıktı | Tüketen | Nasıl yenilenir |
|---|---|---|---|
| `scripts/build-universe.mjs` | `client/public/universe.json`, `universe-summary.json`, `api/_data/latest-holdings.json`, `api/_data/cusip-tickers.json`, `api/_data/filer-meta.json` | `/screen`, `api/_lib/latestHoldings.js` | `universe.yml` (gece 01:23 UTC), commit |
| `scripts/build-consensus.mjs` (`api/_lib/consensusBuild.js`) | `client/public/consensus.json`, `client/public/stocks.json`, `client/public/returns.json`, `api/_data/consensus-pro.json`, `api/_data/guru-stocks.json`, `api/_data/ticker-meta.json`, `api/_data/sector-map.json` | ana sayfa, `/consensus`, `api/_handlers/consensus.js` (Pro kısmı) | `consensus.yml` (universe bitince), commit |
| `scripts/build-guru-history.mjs` | `api/_data/guru-history.json`, `api/_data/splits.json`, `api/_data/related.json` | `api/_lib/history.js`, `/report`, guru sayfaları | `consensus.yml`, commit |
| `scripts/build-guru-activity.mjs` | `client/public/guru-activity*.json` | `/report` | `consensus.yml`, commit |
| `scripts/build-filings.mjs` (`api/_lib/filings.js`) | `client/public/filings.json` | `/filings`, `scripts/send-alerts.mjs` | `consensus.yml`, commit |
| `scripts/build-insiders.mjs` | `api/_data/insiders.json`, `client/public/insiders-teaser.json` | `/insiders`, `api/_handlers/insider-feed.js` | `insiders.yml`, commit |
| `scripts/build-report.mjs` | `api/_data/reports/<yıl>-q<n>.json`, `reports/` | `/report/:id` | elle (`npm run report`) |

`api/_lib/holdingsStore.js` tek Supabase okuyucusudur ve **yalnız
`HISTORY_STORE=1` iken** devreye girer; hedefi `supabase/history-schema.sql`
ile tanımlanan opsiyonel tarihsel depodur (`filers`, `filings`, `holdings`,
`securities`, `insider_trades`, `backfill_state`). Bu şema canlı projeye
uygulanmamıştır, `scripts/backfill-13f.mjs` hiç çalıştırılmamıştır; okuma yolu
her durumda dosyalara/EDGAR'a düşer.

### PR-B (`claude/relaxed-planck-8dhr6r`, commit `e7203ac`) etkisi

`supabase/migrations/2026-09-20-amendments.up.sql` `public.filings` tablosunu
değiştirir. Bu tablo canlı projede **yoktur**; migration'ın hedefi yalnız
opsiyonel tarihsel depodur. Karar:

- Kolonlar (`period_of_report`, `amendment_type`), indeks ve
  `effective_filings` view'ı **`supabase/history-schema.sql` içine alındı**
  (bu paket). Depo ilk kez kurulduğunda tek dosya yeter; ayrı migration'a
  gerek yok.
- PR-B'den `supabase/migrations/2026-09-20-amendments.{up,down}.sql` ve
  README'deki "Depo: …migrations…" satırı çıkarılmalı (`git rm` + bir satır).
  PR-B'nin geri kalanı (`holdingsStore.js`'in `period_of_report` okuması,
  `backfill-13f.mjs`'in yazması) history-schema ile uyumludur.
- Sonuç: PR-B diff'inde canlı Supabase'e dokunan dosya kalmaz; `migrations/`
  dizini yalnız canlı hesap tablolarının migration'larını taşır.

### Bulgu: `alerts` ve `notification_prefs` canlıda yok

`supabase/schema.sql` bu iki tabloyu tanımlar; `client/src/hooks/useAlerts.js`
ve `scripts/send-alerts.mjs` okur/yazar. Canlı `public` şemasında olmadıkları
için alert özelliği bugün çalışmıyor (PostgREST 404). Bu paketin kapsamı
dışında; ayrı migration ister.

## 2. RLS ve Pro erişimi (S2) — `migrations/0001_rls`

Canlı `pg_policies` dökümü bu ortamdan alınamadı (projeye ağ erişimi yok);
aşağıdaki "önce" tablosu canlı şemanın tanımı (`supabase/schema.sql` +
proje açıklaması) üzerinden `migrations/0000_baseline` ile yerelde
üretildi. Canlıda doğrulamak için:

```sql
select tablename, policyname, cmd, roles, qual, with_check
from pg_policies where schemaname = 'public' order by 1, 2;
```

**Önce**

| tablo | policy | cmd | roller | using | with check |
|---|---|---|---|---|---|
| profiles | read own profile | SELECT | public | `auth.uid() = id` | |
| watchlists | own watchlist | ALL | public | `auth.uid() = user_id` | `auth.uid() = user_id` |

**Sonra**

| tablo | policy | cmd | roller | using | with check |
|---|---|---|---|---|---|
| profiles | profiles_select_own | SELECT | authenticated | `auth.uid() = id` | |
| profiles | profiles_update_own | UPDATE | authenticated | `auth.uid() = id` | `auth.uid() = id` |
| watchlists | watchlists_select_own | SELECT | authenticated | `auth.uid() = user_id` | |
| watchlists | watchlists_insert_own | INSERT | authenticated | | `auth.uid() = user_id` |
| watchlists | watchlists_update_own | UPDATE | authenticated | `auth.uid() = user_id` | `auth.uid() = user_id` |
| watchlists | watchlists_delete_own | DELETE | authenticated | `auth.uid() = user_id` | |

Policy dışı korumalar:

- `profiles`: `anon` rolünün tablo yetkisi kaldırıldı; `authenticated`'dan
  INSERT/DELETE yetkisi kaldırıldı (INSERT yalnız `handle_new_user` trigger'ı,
  `plan='free'`, `on conflict do nothing`).
- `profiles_guard_columns` (BEFORE UPDATE): istek `request.jwt.claims`
  içinde `service_role` dışında bir rolle geldiyse `id, email, plan,
  plan_expires, stripe_customer_id, stripe_subscription_id, created_at`
  değişikliği `42501` ile reddedilir. JWT yoksa (SQL editor, psql, migration)
  serbest. `email` listede çünkü alert digest'i `profiles.email`'e gönderiyor;
  kullanıcının kendi satırında değiştirebileceği kolon bugün yok, ileride
  eklenecek bir kolon bu listeye girmez.
- `auth.users.email` değişince `profiles.email` senkronlanır
  (`on_auth_user_email_changed`).
- `watchlists`: satır sınırı free **10**, pro **200**;
  `watchlists_10_cap` AFTER INSERT … FOR EACH STATEMENT (transition table).
  Satır bazlı BEFORE trigger aynı INSERT'in önceki satırlarını görmez;
  istemcinin çok satırlı upsert'i sınırı tek ifadeyle aşabilirdi.
  Var olan satıra upsert büyüme sayılmaz. Hata mesajı `watchlist limit …`,
  hint `watchlist-cap` (#14 paketi bu hint'i UI'da yakalayabilir).
- `is_pro(uid default auth.uid())`: `plan = 'pro' and (plan_expires is null
  or plan_expires > now())`. SECURITY INVOKER: kullanıcı token'ı yalnız kendi
  cevabını alır; `anon` çalıştıramaz.

### Pro içerik nerede gate'leniyor

Sunucu: `api/_lib/auth.js` → `POST /rest/v1/rpc/is_pro` (kullanıcı JWT'si
ile; Supabase doğrular, RLS altında kendi satırı). `requirePro`/`isPro`
kullanan uçlar: `consensus`, `insiders`, `insider-feed`, `export`,
`backtest`, `position-history`, `stock-ownership`, `holdings?full=1`,
`guru-stocks` (tam liste). Pro yanıtlar `Cache-Control: private, no-store`.

İstemci: `client/src/auth.jsx` aynı RPC'yi çağırır, `isPro` yalnız rozet ve
kilit çizer. React state'ini `pro` yapmak sunucudan Pro veri getirmez (402).

Kalan boşluk (bu paketin dışı, ürün kararı): `/screen` gelişmiş filtreleri
ve `/report`'un 10+ satırı **herkese açık statik JSON** (`client/public/
universe.json`, `guru-activity*.json`) üzerinde yalnız UI ile kilitli. Veri
zaten CDN'de; gerçekten Pro olacaksa dosyalar `api/_data`'ya taşınıp bir
`requirePro` ucundan sunulmalı.

### Doğrulama

- Yerel: `npm run test:db` → `tests/sql/0001_rls.test.sql` (7 blok: kullanıcı
  token'ı ile plan/plan_expires/stripe_*/email → 42501; başka kullanıcının
  satırı → 0; anon → yetki yok; service_role → başarılı; is_pro üç durum;
  cap 10/200 + toplu insert; e-posta senkronu).
- Canlı: `tests/supabase-rls.test.mjs` — `SUPABASE_TEST_URL`,
  `SUPABASE_TEST_ANON_KEY`, `SUPABASE_TEST_SERVICE_KEY` ile iki geçici
  kullanıcı açar, aynı üç senaryoyu PostgREST üzerinden koşar, kullanıcıları
  siler; secret yoksa skip.

## 3. Şema temizliği ve kısıtlar (S3) — `migrations/0002_constraints`

| Konu | Karar |
|---|---|
| `profiles.plan` | `CHECK (plan in ('free','pro'))`, default `'free'`, NOT NULL. Migration önce `select distinct plan` eşdeğeri bir ön-kontrol yapar; `free`/`pro` dışı değer varsa **değeri yazarak durur**, satırı sessizce değiştirmez. Canlıda uygulamadan önce: `select plan, count(*) from public.profiles group by 1;` |
| `plan_expires IS NULL` + `plan='pro'` | **Süresiz (manuel/ömür boyu) hak.** `is_pro()` aktif sayar. Stripe'tan gelen her satır `current_period_end` taşır; NULL yalnız SQL'den verilen bir hakta görülür. Kolon yorumlarına yazıldı. |
| `is_pro(uid)` | `0001`'de tanımlı (watchlist sınırı ona bağlı). Sunucu (`api/_lib/auth.js`), istemci (`client/src/auth.jsx`) ve watchlist trigger'ı aynı fonksiyonu çağırır; koddaki `plan === 'pro'` karşılaştırmaları yalnız bu fonksiyonun döndürdüğü değeri UI'a taşır. |
| `ls_customer_id` | Repoda okuyan/yazan yok (`grep -rn ls_customer_id` → yalnız bu doküman). `DROP COLUMN`; down dosyası boş olarak geri ekler. |
| `stripe_customer_id`, `stripe_subscription_id` | Kısmi UNIQUE index (`where … is not null`). Ön-kontrol çift kayıt varsa durur. |
| `watchlists.cik` | Site 10 haneli sıfır dolgulu kullanır (`client/src/lib/paths.js`, `api/_lib/slugs.js`); alert eşleştirmesi "iki biçimde de gelebilir" diyordu, yani canlıda dolgusuz satır olabilir. Migration: dolgulu eşi olan dolgusuz satırı siler, kalanları `lpad(btrim(cik),10,'0')` yapar, hâlâ 10 hane olmayan varsa **durur**; sonra `watchlists_00_normalize_cik` BEFORE INSERT/UPDATE trigger'ı (gelen değeri doldurur) ve `CHECK (cik ~ '^[0-9]{10}$')`. Trigger adı `watchlists_10_cap`'ten önce çalışacak şekilde seçildi (Postgres trigger'ları ad sırasıyla çalıştırır). |

Doğrulama: `tests/sql/0002_constraints.test.sql` (plan CHECK, kolon yok,
UNIQUE, dolgu + CHECK, ve migration'ın onarım adımlarının dolgusuz tohum
satırlarda yeniden koşusu).

## 4. Stripe webhook: idempotency ve plan senkronu (S4) — `migrations/0003_stripe_events`

- `stripe_events (id text PK = Stripe event id, type, user_id, outcome,
  processed_at)`; RLS açık, policy yok, `anon`/`authenticated` yetkisi yok —
  yalnız service role.
- `apply_stripe_event(event_id, type, user_id, patch jsonb, outcome)`:
  SECURITY DEFINER, yalnız `service_role` çalıştırır. Event satırını yazar
  (`on conflict do nothing`; varsa `'duplicate'` döner, hiçbir şey yapmaz) ve
  aynı transaction'da profil patch'ini uygular. Profil yoksa event
  `skipped:no-profile` olarak kaydedilir (Stripe 3 gün boşuna retry etmesin).
- Handler (`api/_handlers/stripe-webhook.js`): imza → event id (`evt_…`
  zorunlu) → `stripe_events`'te var mı (varsa `200 duplicate`) → karar →
  RPC. Herhangi bir hata `500` (Stripe retry eder).
- Event → profil eşlemesi ve kullanıcı eşleme kuralı: `docs/STRIPE-KURULUM.md`
  §2. E-posta ile eşleme yok; `client_reference_id`/`metadata.user_id`
  (`/api/checkout` yazar) ve yedek olarak `stripe_customer_id`.
- `invoice.payment_failed`: yalnız log; ödemesiz süre Stripe Smart Retries
  (§3b). `past_due` abonelik dönem sonuna kadar Pro kalır.
- Pro tanımı: `is_pro()`; `plan === 'pro'` karşılaştırması sunucuda kalmadı
  (`getUser().pro`, `isPro()`).

### Doğrulama

Stripe CLI bu ortamda yok, Stripe ve Supabase'e ağ erişimi yok. Aynı akış
`tests/stripe-webhook.test.mjs` ile koşuyor: gerçek handler, gerçek imza
doğrulaması, gerçek axios çağrıları; karşı tarafta `apply_stripe_event`'i
birebir taklit eden yerel bir Supabase ve `GET /v1/subscriptions` cevaplayan
yerel bir Stripe (`STRIPE_API_BASE`). Çıktı:

| event | http | result | plan | plan_expires | stripe_customer_id | stripe_subscription_id |
|---|---|---|---|---|---|---|
| checkout.session.completed | 200 | applied | pro | 2027-01-15T08:00:00Z | cus_1 | sub_1 |
| customer.subscription.updated (active, yeni dönem) | 200 | applied | pro | 2027-02-15T08:00:00Z | cus_1 | sub_1 |
| customer.subscription.updated (past_due) | 200 | applied | pro | 2027-03-18T08:00:00Z | cus_1 | sub_1 |
| invoice.payment_failed | 200 | logged | pro | 2027-03-18T08:00:00Z | cus_1 | sub_1 |
| customer.subscription.updated (canceled) | 200 | applied | free | null | cus_1 | sub_1 |
| customer.subscription.deleted | 200 | applied | free | null | cus_1 | null |
| checkout.session.completed (**aynı event id, tekrar**) | 200 | duplicate | free | null | cus_1 | null |

Son satır: ikinci teslimat 200, DB değişmedi, Stripe'a istek gitmedi. SQL
tarafı: `tests/sql/0003_stripe_events.test.sql` (aynı id iki kez → ikinci
`duplicate`, satır aynı; kullanıcı token'ı fonksiyonu çağıramaz, tabloyu
okuyamaz).
