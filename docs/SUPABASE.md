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
