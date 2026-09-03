# 📡 13F Radar

SEC 13F dosyalamalarıyla büyük fon yöneticilerinin portföylerini takip eden, Finimize esintili tasarıma sahip web uygulaması.

**Özellikler**
- 🔍 EDGAR üzerinde fon yöneticisi arama; fon sayfası: Özet / Portföy / Tüm Pozisyonlar, portföy haritası (treemap), AUM ve akış geçmişi, fon bilgisi
- 🧾 Pozisyon tablosu: ağırlık, son işlem (adet değişimi), sahiplik geçmişi, tahmini ortalama alış fiyatı, 1Y/YTD getiri; hisse / opsiyon görünümü; CSV / Excel dışa aktarma
- 📈 **Pozisyon zaman çizelgesi**: her (fon, hisse) için çeyreklik ağırlık / değer / adet grafiği ve YENİ / ARTIRDI / AZALTTI / ÇIKTI rozetleri (eksik çeyrekler ve düzeltmeler doğru işlenir)
- ⚖️ **Fon örtüşmesi**: 2–5 fon, ortak/tekil pozisyonlar, Jaccard ve ağırlıklı örtüşme, ortak alım-satımlar
- 🔔 **Uyarılar**: takip edilen fon yeni 13F dosyaladığında Türkçe e-posta özeti (yeni / artırılan / azaltılan / çıkılan); hisse uyarıları; asla iki kez gönderilmez
- ⭐ **İzleme listeleri ve fon grupları**: hisse izleme listesi (kurumsal sahiplik ve çeyreklik değişim), AUM veya eşit ağırlıklı "süper fon" portföyü
- 👤 **İçeriden işlemler (Form 4)**: günlük ingest, en büyük alım/satışlar, rol / tutar / metin filtreleri; hisse sayfasında rol bilgisi
- 🏛️ **Kongre işlemleri (STOCK Act)**: Temsilciler Meclisi ve Senato bildirimleri, parti / üye / sembol / tutar bandı filtreleri
- 🏆 **Fon performans skoru**: 13F portföyünün varsayımsal 1Y / 3Y getirisi, SPY farkı, aktivite, ilk 10 yoğunlaşması, AUM trendi; uygulama içi metodoloji
- 🧪 **13F hisse tarayıcı**: fon sayısı, artıran/azaltan fon, net kurumsal akış, konsensüs skoru, sektör (SIC), büyüklük (SEC public float); kayıtlı taramalar
- ⏪ **Backtest**: fon veya fon grubu, dosyalama yayın tarihinde (çeyrek sonu + 45 gün) yeniden dengeleme, S&P 500 karşılaştırmalı getiri eğrisi, CAGR, maksimum düşüş
- 🌡️ **Akış ısı haritası**: sektör → hisse net kurumsal akış treemap'i
- 📢 **13D/13G**: yapılandırılmış XML bildirimlerinden pay yüzdesi, bildiren ve olay tarihi; hisse başına sahip zaman çizelgesi
- 🧭 **Tematik ETF akışları**: Bitcoin, altın, gümüş, petrol ETF'lerinde kurumsal pozisyonlar ve çeyreklik değişim
- 🇹🇷 **Türkiye Radarı**: TUR ETF ve Türk ADR'lerini tutan ABD kurumları, çeyreklik akış, veriden üretilen Türkçe özet
- 🧭 Usta yatırımcı konsensüsü, çeyrek raporu, fon tarayıcı, hisse detay sayfası (Yahoo verisi), ⌘K komut paleti, PDF/yazdır
- 🔌 **Salt okunur REST API** (Pro, API anahtarı) ve tüm tablolarda CSV / Excel dışa aktarma
- 🌗 Açık/koyu tema, 🇹🇷/🇬🇧 çift dil, mobil uyumlu; her sayfada SPK notu

## Veri kaynakları ve güncelleme sıklığı

| Veri | Kaynak | Nasıl | Sıklık |
|---|---|---|---|
| 13F-HR / 13F-HR/A pozisyonları | SEC EDGAR (submissions + Archives XML) | İstek anında, önbellekli; düzeltmeler (NEW HOLDINGS birleştirilir, RESTATEMENT yerine geçer) | Anlık (7 gün önbellek) |
| Evren (tüm dosyalayıcılar), hisse evreni, artıran/azaltan, net akış, sektör (SIC), public float, Türkiye Radarı, tematik ETF'ler | SEC EDGAR full-index + Archives + submissions + XBRL companyconcept | `scripts/build-universe.mjs` → `client/public/{universe,stocks,stocks-prev,turkey,themes}.json` | Haftalık (Pazartesi 03:00 UTC) |
| Konsensüs, 1Y/YTD getiriler | EDGAR + Twelve Data / Yahoo | `scripts/build-consensus.mjs` → `consensus.json`, `returns.json` | Günlük (04:30 UTC) |
| Fon performansı | EDGAR + FMP → Twelve Data → Stooq kapanışları | `scripts/build-performance.mjs` → `performance.json` | Haftalık (Salı 05:00 UTC) |
| İçeriden işlemler (Form 4) | SEC EDGAR daily-index + Form 4 XML | `scripts/build-insiders.mjs` → `insiders.json` (son 30 gün) | Günlük (06:00 UTC) |
| Kongre işlemleri | House / Senate Stock Watcher açık veri setleri + congress-legislators | `scripts/build-congress.mjs` → `congress.json` (son 12 ay) | Günlük (07:00 UTC) |
| Uyarı e-postaları | EDGAR + Supabase + Resend | `scripts/send-alerts.mjs` | 2 saatte bir |
| Hisse fiyat/temel veri | Yahoo Finance (yedek: Stooq, FMP, Twelve Data) | İstek anında | Anlık |
| Schedule 13D/G | SEC EDGAR (yapılandırılmış XML, Aralık 2024 sonrası) | İstek anında | Anlık (6 saat önbellek) |
| CUSIP → ticker | OpenFIGI + statik harita | Haftalık evren build'inde | Haftalık |

13F dosyalamaları çeyrek sonunu izleyen 45 gün içinde açıklanır; tüm 13F tabanlı veriler bu gecikmeyle gelir.

## Ücretsiz ve Pro

Ücretsiz plan: her fon için son iki çeyrek (pozisyon zaman çizelgesi, sahiplik geçmişi), pozisyon tablosunda ilk 10 satır, 2 fonlu karşılaştırma, 5 öğelik izleme listesi ve uyarı, 1 fon grubu (5 fon), içeriden / Kongre / performans / tarayıcı listelerinde ilk 20–50 satır, ısı haritasında sektör seviyesi, 13D/G'de son 3 bildirim. Pro plan (aylık abonelik): tüm geçmiş ve sınırsız izleme/uyarı, 5 fonlu karşılaştırma, 20 fonluk gruplar, tüm filtreler, kayıtlı taramalar, backtest, hisse seviyesinde ısı haritası, 13D/G detayları, CSV / Excel dışa aktarma ve REST API anahtarları. Plan `profiles.plan` alanında tutulur (Lemon Squeezy webhook'u günceller); sunucu tarafı `api/_lib/plan.js` sınırları uygular, istemci `client/src/lib/planLimits.js` ile aynı değerleri gösterir.

## Modül bayrakları

Her yeni modül bir bayrakla kapatılabilir: sunucuda `FEATURE_FLAGS`, istemcide `VITE_FEATURE_FLAGS` (örn. `alerts=off,congress=off`). Bayraklar: `positionTimeline, overlap, alerts, watchlists, insiders, congress, performance, screener, backtest, heatmap, filings13dg, themes, exportApi, turkeyRadar`.

## Mimari

| Katman | Teknoloji |
|---|---|
| Frontend | React 18 + Vite + React Router v6 + TanStack Query v5 + Recharts (JavaScript) |
| API (Prod) | Tek Vercel Serverless Function (`api/index.js` yönlendirir → `api/_handlers/*`) |
| API (Dev) | Express (`server.js`) |
| Veri | SEC EDGAR (canlı + statik JSON), Yahoo Finance / Stooq / FMP / Twelve Data, OpenFIGI |
| Kullanıcı verisi | Supabase (auth, `profiles.plan`, izleme listeleri, uyarılar, fon grupları, kayıtlı taramalar, API anahtarları) — şema: `supabase/schema.sql` |
| Kalite | `npm run check` = ESLint + `tsc --checkJs` (`// @ts-check` modülleri) + `node --test` (60+ birim testi: parser'lar, diff motoru, örtüşme, performans, uyarı şablonları) |

```
api/_lib/        sec.js (EDGAR + düzeltme birleştirme), positionDiff.js, overlap.js, alerts.js,
                 groupPortfolio.js, performance.js, backtest.js, form4.js, congress.js,
                 universeAgg.js, stocksSnapshot.js, turkey.js, themes.js, flowTree.js,
                 schedule13.js, apiKeys.js, plan.js, flags.js, validate.js
api/_handlers/   bir dosya = bir uç nokta
scripts/         build-universe, build-consensus, build-performance, build-insiders,
                 build-congress, send-alerts (GitHub Actions ile çalışır)
client/src/      pages/, components/, lib/, i18n.jsx (TR/EN)
tests/           node:test birim testleri
```

## Yerel Geliştirme

```bash
npm install
npm install --prefix client

# 1. terminal — API dev sunucusu (http://localhost:3001)
npm run dev

# 2. terminal — Vite (http://localhost:5173, /api -> 3001 proxy)
npm run dev:client
```

## 🚀 Canlıya Alma (Vercel)

1. Bu branch'i `main`'e merge edin (veya doğrudan bu branch'i deploy edin).
2. [vercel.com](https://vercel.com) → **Add New → Project** → GitHub'dan `mustafakocer/13FRadar` reposunu import edin.
3. Ayarlara dokunmanıza gerek yok — `vercel.json` her şeyi tanımlıyor (client build + `api/` fonksiyonları + SPA rewrites). Framework sorusuna **Other** deyin.
4. **Deploy** butonuna basın. İlk build ~2 dk sürer.
5. (Önerilen) Environment Variables:
   - `SEC_USER_AGENT` → `13FRadar/1.0 (sizin@email.com)` — SEC, istekler için iletişim bilgisi ister.
   - `OPENFIGI_API_KEY` → [openfigi.com/api](https://www.openfigi.com/api) üzerinden ücretsiz alın; CUSIP→ticker çözümlemeyi 10 kat hızlandırır (100'lük batch, yüksek rate limit).
   - `FEATURE_FLAGS` (sunucu) / `VITE_FEATURE_FLAGS` (istemci) → modülleri kapatmak için, örn. `alerts=off,congress=off`.
   - Uyarılar (GitHub Actions secrets): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `ALERTS_FROM`, `SITE_URL` (vars). Şema: `supabase/schema.sql` içindeki `alert_*` tabloları uygulanmalı.
6. Domain bağlamak isterseniz: Project → Settings → Domains.
7. **Supabase**: `supabase/schema.sql` dosyasını projeye uygulayın (profiles, watchlists, alert_subscriptions, alert_deliveries, stock_watchlist, fund_groups, fund_group_members, saved_screens, api_keys). Vercel'e `SUPABASE_SERVICE_ROLE_KEY` ekleyin (webhook ve REST API anahtar doğrulaması için).
8. **GitHub Actions secrets**: `OPENFIGI_API_KEY`, `TWELVEDATA_API_KEY`, `FMP_API_KEY` (opsiyonel), `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `ALERTS_FROM`; vars: `SITE_URL`. İlk çalıştırma: `Build 13F universe` (uzun sürer), ardından `Build insider transactions` (`days=30`), `Build congress trades`, `Build fund performance`.

### Evren Verisi (Tarayıcı için)

`Tarayıcı` sayfası `client/public/universe.json` bulursa tüm 13F evreninde filtreleme yapar; yoksa seçili 20 yönetici ile canlı modda çalışır. Dosyayı üretmek için:

- **GitHub Action:** `Actions → Build 13F universe → Run workflow` (haftalık cron da tanımlı; cron yalnızca varsayılan branch'te çalışır). Tam tarama EDGAR hız limitlerine saygılı şekilde ~1-2 saat sürer ve dosyayı repoya commit'ler; Vercel otomatik yeniden deploy eder.
- **Yerelde:** `UNIVERSE_LIMIT=500 node scripts/build-universe.mjs` (test için ilk 500 dosyalayıcı).

### İleride (dış servis gerektirir)

- **E-posta bildirimi:** Vercel Cron + KV + Resend hesabı ile izleme listesine yeni 13F bildirimi. Şimdilik uygulama içi "YENİ 13F" rozetleri var.
- **Hesap + senkron izleme listesi:** Supabase/Clerk entegrasyonu gerekir; bugün localStorage kullanılıyor.

### Notlar / Bilinen Sınırlar
- Yahoo Finance resmi olmayan API'dir; nadiren crumb/cookie yenilemesi gerekir (client otomatik dener).
- Çok büyük dosyalamalar (ör. Citadel, binlerce pozisyon) ilk yüklemede yavaş olabilir; sonuçlar edge + bellek cache'iyle hızlanır.
- 2023 öncesi 13F değerleri bin dolar cinsindendir; dönüşüm otomatik yapılır (`valueMultiplier`).
- Popüler yönetici listesi `client/src/data/popular.js` içinde düzenlenebilir.
