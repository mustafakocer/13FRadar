# 📡 13F Radar

SEC 13F dosyalamalarıyla büyük fon yöneticilerinin portföylerini takip eden, Finimize esintili tasarıma sahip web uygulaması.

**Özellikler**
- 🔍 EDGAR üzerinde gerçek zamanlı fon yöneticisi arama (isim veya CIK)
- 📁 Yönetici detay sayfası: Özet / Portföy / Tüm Pozisyonlar sekmeleri
- 📊 AUM geçmişi grafiği, tahmini çeyreklik net fon akışı (SPY'a göre piyasa etkisinden arındırılmış)
- 🃏 Portföy kartları: En Büyük Pozisyonlar · Yeni/Artırılan · Azaltılan/Çıkılan (önceki çeyrekle karşılaştırmalı)
- 🧾 Sıralanabilir, filtrelenebilir tam pozisyon tablosu + Excel'e aktarma (SheetJS, code-split)
- 💹 Hisse detay sayfası: Yahoo Finance verisiyle fiyat, değerleme oranları (F/K, PEG, PD/DD, EV/EBITDA…), temel veriler, gelir tablosu / bilanço / nakit akışı, kazanç geçmişi
- 📈 1Y / YTD / 1G getiriler (Yahoo v8 chart, regular close)
- 🏷️ CUSIP → ticker çözümleme (OpenFIGI)
- ⚖️ İki yönetici karşılaştırma + 2-3 hisse rasyo karşılaştırma, 📋 tarayıcı, ⭐ izleme listesi (localStorage)
- 🧭 **Süper Yatırımcı Konsensüsü** — seçili fonların birleşik görünümü: en çok tutulan, bu çeyrek en çok alınan/satılan, yeni pozisyon radarı
- 🎯 Opsiyon görünümü (PUT/CALL pozisyonları ayrı tablo + toplam ağırlıklar)
- 🧪 Kopyalama backtesti (deneysel): "13F'i her çeyrek kopyalasaydım" vs SPY
- 👤 İçeriden işlemler (Form 4) hisse sayfasında
- 🔔 İzleme listesinde yeni 13F rozetleri, ⌘K komut paleti, 🖨 PDF/yazdır raporu
- 🌍 Tam evren tarayıcı: haftalık GitHub Action tüm ~8.000 13F dosyalayıcısını tarayıp `client/public/universe.json` üretir
- 🏠 **Landing:** akıllı para hero'su, endeks şeridi (SPY/QQQ/IWM), gerçek zamanlı insider sinyalleri (piyasa nabzı · küme / C-suite / kuruş hisse alımları), usta yatırımcı konsensüsü, yönetici bazlı portföy güncellemeleri (Yeni Alım / Artırdı / Azalttı / Çıktı), çeyreklik piyasa aktivitesi — tamamı statik CDN dosyalarından, paywall'suz
- 🌗 Açık/koyu tema, 🇹🇷/🇬🇧 çift dil — dil otomatik seçilir: Türkiye'den gelen ziyaretçi TR, diğer ülkeler EN (`/api/geo`, Vercel ülke başlığı); TR/EN anahtarı ile yapılan seçim kalıcıdır

## Mimari

| Katman | Teknoloji |
|---|---|
| Frontend | React 18 + Vite + React Router v6 + TanStack Query v5 + Recharts |
| Rendering | SSR: `api/ssr.js` her herkese açık sayfayı sunucuda render eder (aşağıya bakın) |
| API (Prod) | Vercel Serverless Functions (`api/` dizini) |
| API (Dev) | Express (`server.js`, Vercel routing emülasyonu) |
| Veri | SEC EDGAR (submissions + full-text search + Archives), Yahoo Finance (v7/v8/v10, cookie+crumb), OpenFIGI |

```
api/
  _lib/          # sec.js, yahooClient.js, figi.js, cache.js
  search.js                  # GET /api/search?q=
  manager/[cik].js           # GET /api/manager/:cik
  holdings/[cik]/[acc].js    # GET /api/holdings/:cik/:acc?fd=&light=1
  aum-history/[cik].js       # GET /api/aum-history/:cik
  returns.js                 # GET /api/returns?symbols=A,B,C
  stock/[ticker].js          # GET /api/stock/:ticker
client/          # Vite + React uygulaması
```

## Rendering Stratejisi (SSR + CDN cache)

Herkese açık her sayfa sunucuda render edilir; tarayıcı tam HTML (başlıklar, tablolar, meta/JSON-LD) alır ve hydrate eder. Next.js'e geçilmedi: aynı Vite uygulaması `vite build --ssr` ile bir de sunucu paketi üretir, `api/ssr.js` bu paketi çağırır.

- `vercel.json`: `/api/*` dışındaki her yol `api/ssr.js`'e yönlenir (statik dosyalar önce gelir).
- `api/_lib/ssr/routes.js`: rota → veri yükleyici. Yükleyiciler API handler'larını **süreç içinde** çağırır (HTTP yok) ve TanStack Query önbelleğini sayfanın kullandığı anahtarlarla doldurur; istemci `window.__STATE__` üzerinden hydrate olur.
- Ücretsiz katman sunucuda render edilir; Pro bölümler (tam tablolar, insider akışı, backtest) istemcide yüklenir.
- **ISR eşdeğeri (CDN cache):** fon/hisse/guru×hisse sayfaları `s-maxage=86400, stale-while-revalidate=604800` (günlük tazelenir, 7 gün eskisi sunulabilir); ana sayfa, konsensüs, sıralamalar ve insider sinyal sayfaları `s-maxage=3600` + 1 gün SWR; hesap/izleme listesi `no-store`. Politika `CACHE` sabitinde (`routes.js`).
- **Dil yolları:** her URL `/en/…` veya `/tr/…`. Öneksiz URL'ler 302 ile yönlenir: `lang` çerezi → Vercel ülke başlığı (`TR` → tr) → `Accept-Language` → en. `hreflang` en/tr/x-default her sayfada; canonical kendine işaret eder.
- **Slug'lar:** `api/_data/slugs.json` (`npm run slugs`) her 13F dosyalayıcı için kalıcı, ASCII, benzersiz slug tutar; `/manager/<cik>` 301 ile `/guru/<slug>` (küratörlü) veya `/filer/<slug>`'a gider. Bir kez atanmış slug asla değişmez; yeni çakışmalar CIK sonekiyle çözülür.
- `<head>`: `useSeo()` (client/src/seo.jsx) sunucuda toplanır, istemcide her gezinmede aynalanır. Şablonlar `client/src/lib/seoTemplates.js` (başlık/açıklama gerçek sayılarla, FAQ, breadcrumb, Organization/WebSite JSON-LD).

### Gerekli ortam değişkenleri

| Değişken | Zorunlu | Açıklama |
|---|---|---|
| `SITE_URL` | **Prod'da evet** (`scripts/check-env.mjs` build'i durdurur) | Canonical, hreflang, sitemap ve OG görsel URL'lerinin kökü, ör. `https://13fradar.com`. Preview'da `VERCEL_URL`'den türetilir. |
| `SEC_USER_AGENT` | önerilir | SEC'in istediği iletişim bilgisi |
| `OPENFIGI_API_KEY` | önerilir | CUSIP→ticker |
| `FMP_API_KEY`, `TWELVEDATA_API_KEY` | opsiyonel | fiyat/rasyo sağlayıcıları |
| Stripe / Supabase | ödeme için | bkz. docs/STRIPE-KURULUM.md |
| `SEC_FIXTURE_DIR`, `GURU_HISTORY_FILE` | yalnız test | çevrimdışı fixture'lar (`tests/fixtures`) |

### GEO (generative engine optimization) kontrol listesi

| Öğe | Nerede | Durum |
|---|---|---|
| AI tarayıcılarına açık `robots.txt` (GPTBot, ChatGPT-User, OAI-SearchBot, ClaudeBot, Claude-User, anthropic-ai, PerplexityBot, Perplexity-User, Google-Extended, Bingbot, Applebot, CCBot) | `api/_handlers/sitemap.js` → `/robots.txt` | ✅ test: her UA ile 3 sayfa 200 + `<table>` |
| UA'ya göre engelleme / JS challenge yok | `vercel.json`, `api/ssr.js` (UA okunmaz) — Vercel panelindeki "Bot Protection"/WAF ayarı **kapalı** kalmalı | ✅ kodda yok; panel ayarı manuel kontrol |
| `/llms.txt`, `/llms-full.txt` | `scripts/build-llms.mjs`, build'de üretilir (`npm run llms` ile elle) | ✅ test: llmstxt.org yapısı |
| Cevap kutusu (H1 altında 2–3 cümle, veri odaklı, EN+TR) | `client/src/lib/answerBox.js`, `<AnswerBox>` | ✅ guru, hisse, sıralama, takvim, rapor, rehber |
| Meta description = cevap kutusu (≤155) · JSON-LD `description` = cevap kutusu | `seoTemplates.js`, `jsonld.js` | ✅ |
| JSON-LD yığını: Person/Organization + Dataset + FAQPage + Breadcrumb (guru); Corporation + Dataset + FAQ + Breadcrumb (hisse); Article + ItemList + FAQ + Breadcrumb (sıralama, takvim, rapor); Organization(sameAs) + WebSite/SearchAction (ana sayfa) | `client/src/lib/jsonld.js` | ✅ `scripts/check-jsonld.mjs` build'i durdurur |
| `dateModified` (son işlenen bildirim) her varlık sayfasında + sitemap `lastmod` | `useSeo({dateModified})`, `sitemap.js` | ✅ |
| Benzer yöneticiler (Jaccard, gece hesaplı) | `scripts/build-related.mjs` → `api/_data/related.json` | ✅ |
| İçerik motorları: `/calendar`, `/emerging-managers`, `/reports/{yyyy}-q{n}`, rehberler, karşılaştırmalar | `client/src/pages/*`, `client/src/content/*` | ✅ rakip hücreleri TODO (doğrulanmadan yazılmaz) |
| AI atıf izleme | `scripts/geo-monitor.ts` | ✅ aylık elle çalıştırılır (CI'da değil) |

Sosyal profiller (Organization `sameAs`): build ortamında `VITE_SOCIAL_LINKS="https://x.com/...,https://www.linkedin.com/company/..."` (virgülle ayrılmış). Boşsa alan yazılmaz.

**llms.txt'yi yeniden üretme:** `SITE_URL=https://alanadi npm run llms` (build sırasında otomatik). İçerik şu dosyalardan gelir: `slugs.json`, `consensus.json`, `stocks.json`, `insiders-teaser.json`, `guru-history.json`, `api/_data/reports/index.json`, `client/src/content/registry.js`.

**Çeyrek raporu üretme:** `npm run report -- 2026 2` → `api/_data/reports/2026-q2.json` (sayfa: `/en/reports/2026-q2`, API: `/api/report-id/2026-q2`, markdown: `?format=md`, grafik paketi: `/api/og?type=report&id=2026-q2&chart=buys|sells|moves`) ve `reports/2026-q2.md`. Girdi: `api/_data/consensus-pro.json` (+ varsa `guru-history.json`). Çıktıyı commit'leyin; sitemap ve llms.txt indeksten otomatik güncellenir.

**AI atıf izleme (aylık):**
```bash
export ANTHROPIC_API_KEY=…    # ve/veya
export OPENAI_API_KEY=…       # eksik olan sağlayıcı atlanır
npm run geo-monitor -- --dry-run   # soruları listeler, çağrı yapmaz
npm run geo-monitor                # geo-monitor/results.csv'ye ekler, geo-monitor/<tarih>.json ham çıktı
```
Sorular `scripts/geo-monitor.config.json` (20 soru, EN+TR). Sütunlar: tarih, soru, dil, sağlayıcı, model, atıf yapılan alan adları, metinde geçen alan adları, bizim alan adımız var mı, cevap uzunluğu, hata. Her ayın ilk haftası çalıştırıp `our_domain_cited` oranını takip edin; CI'da çalıştırmayın (ücretli API çağrısı).

### Sitemap, robots, OG

- `/sitemap.xml` indeks; `/sitemap-pages.xml`, `-gurus.xml` (guru + guru×hisse sayfaları), `-filers.xml`, `-stocks.xml`, `-insider.xml`. Hepsi `api/_handlers/sitemap.js` tarafından istek anında üretilir (6 saat CDN cache) — ayrıca "yeniden üretme" adımı yoktur; kaynak dosyalar (`slugs.json`, `universe.json`, `stocks.json`, `insiders-teaser.json`, `guru-history.json`) Action'larla yenilendiğinde sitemap kendiliğinden güncellenir. `lastmod` en son bildirim tarihinden gelir.
- `/robots.txt`: her şeye izin, `/api/` ve hesap/izleme listesi yolları hariç; sitemap indeksini gösterir.
- `/api/og?type=guru&cik=…` ve `/api/og?type=stock&ticker=…` 1200×630 PNG üretir (resvg + paketlenmiş DejaVu Sans); diğer sayfalar varsayılan kartı kullanır.

### Önceden hesaplanan veriler (Action'lar)

| Dosya | Üreten | Sıklık | İçerik |
|---|---|---|---|
| `client/public/consensus.json`, `api/_data/consensus-pro.json` | `scripts/build-consensus.mjs` | günlük | en çok tutulanlar, alım/satımlar, yönetici güncelleme kartları |
| `api/_data/guru-history.json` | `scripts/build-guru-history.mjs` | günlük | 40 çeyrek: çeyreklik geçmiş, elde tutma süresi, guru×hisse serileri |
| `api/_data/splits.json` | `scripts/build-splits.mjs` | günlük | bölünme olayları (adetler split-adjusted) |
| `client/public/insiders-teaser.json`, `api/_data/insiders.json` | `scripts/build-insiders.mjs` | günlük | Form 4 akışı; sınıflandırma: güçlü sinyal / likidite / gürültü, 10b5-1 bayrağı |
| `client/public/universe.json`, `universe-summary.json`, `api/_data/slugs.json` | `scripts/build-universe.mjs` + `build-slugs.mjs` | haftalık | tüm 13F evreni ve slug tablosu |

### Test ve kalite kapıları

```bash
npm run build      # client + SSR paketi
npm test           # node:test — SSR çıktısı, meta/hreflang, FAQ JSON-LD, sitemap, slug, insider taksonomisi, geçmiş
npm run fixtures   # tests/fixtures/sec fixture'larını yeniden üretir

# Lighthouse (yerel SSR sunucusuna karşı; chromium yolu ortamınıza göre)
SEC_FIXTURE_DIR=$PWD/tests/fixtures/sec npm run dev &
npx lighthouse http://localhost:3001/en/guru/berkshire-hathaway-warren-buffett --only-categories=seo,performance --preset=desktop --view
```

Son ölçüm (bu depo, fixture verisi, 2026-09-11): SEO **100** (ana sayfa, guru, hisse, takvim, çeyrek raporu, rehber EN/TR); performans masaüstü **100 / 98 / 98**, mobil simülasyonu **88 / 88 / 90** (takvim 87, rapor 81, rehber 88/89). Kritik JS paketi 221 KB (58 KB gzip); grafikler (Recharts, 430 KB) ve Supabase SDK (377 KB) ilk boyamadan sonra, yalnız gerektiğinde yüklenir; Google Fonts render'ı engellemez.

## Yerel Geliştirme

```bash
npm install
npm install --prefix client

# SSR dahil tam uygulama (önce build gerekir): http://localhost:3001
npm run build && npm run dev

# Yalnız arayüz üzerinde çalışırken (HMR, client-only): http://localhost:5173, /api -> 3001 proxy
npm run dev            # 1. terminal
npm run dev:client     # 2. terminal

# SEC erişimi olmayan ortamda sabit veriyle çalışmak için
SEC_FIXTURE_DIR=$PWD/tests/fixtures/sec npm run dev
```

## 🚀 Canlıya Alma (Vercel)

1. Bu branch'i `main`'e merge edin (veya doğrudan bu branch'i deploy edin).
2. [vercel.com](https://vercel.com) → **Add New → Project** → GitHub'dan `mustafakocer/13FRadar` reposunu import edin.
3. Ayarlara dokunmanıza gerek yok — `vercel.json` her şeyi tanımlıyor (client build + `api/` fonksiyonları + SPA rewrites). Framework sorusuna **Other** deyin.
4. **Deploy** butonuna basın. İlk build ~2 dk sürer.
5. Environment Variables — **`SITE_URL` production'da zorunludur** (yoksa build kasıtlı olarak durur). Diğerleri:
   - `SEC_USER_AGENT` → `13FRadar/1.0 (sizin@email.com)` — SEC, istekler için iletişim bilgisi ister.
   - `OPENFIGI_API_KEY` → [openfigi.com/api](https://www.openfigi.com/api) üzerinden ücretsiz alın; CUSIP→ticker çözümlemeyi 10 kat hızlandırır (100'lük batch, yüksek rate limit).
   - `FMP_API_KEY`, `TWELVEDATA_API_KEY` → hisse fiyat/rasyo sağlayıcıları.
   - Ödeme (Stripe): `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_YEARLY`, `STRIPE_PRICE_MONTHLY_TR`, `STRIPE_PRICE_YEARLY_TR`, `SUPABASE_SERVICE_ROLE_KEY` → adım adım kurulum: [docs/STRIPE-KURULUM.md](docs/STRIPE-KURULUM.md).
6. Domain bağlamak isterseniz: Project → Settings → Domains.

### Landing Verisi

Ana sayfa şu statik dosyaları okur (hepsi Action'lar tarafından üretilir, `client/public/`):
`consensus.json` (en çok tutulanlar + `updates` yönetici kartları), `insiders-teaser.json` (nabız, öne çıkan alım, sinyaller), `returns.json` (endeks şeridi ve YBB getiriler), `universe-summary.json` (fon sayısı, toplam AUM, pozisyon sayısı). `updates` alanı ilk kez **Build consensus & returns** workflow'u çalışınca dolar; o ana kadar "Usta Portföy Güncellemeleri" bölümü gizli kalır.

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
