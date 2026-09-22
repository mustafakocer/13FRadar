# 📡 Fundocap

SEC 13F dosyalamalarıyla büyük fon yöneticilerinin portföylerini takip eden, Finimize esintili tasarıma sahip web uygulaması.

**Özellikler**
- 🔍 EDGAR üzerinde gerçek zamanlı fon yöneticisi arama (isim veya CIK)
- 📁 Yönetici detay sayfası: Özet / Portföy / Tüm Pozisyonlar sekmeleri
- 📊 AUM geçmişi grafiği, tahmini çeyreklik net fon akışı (SPY'a göre piyasa etkisinden arındırılmış)
- 🃏 Portföy kartları: En Büyük Pozisyonlar · Yeni/Artırılan · Azaltılan/Çıkılan (önceki çeyrekle karşılaştırmalı)
- 🧾 Sıralanabilir, filtrelenebilir tam pozisyon tablosu + Excel'e aktarma (SheetJS, code-split)
- 💹 Hisse detay sayfası: fiyat (FMP / TwelveData / Finnhub yarışı), değerleme oranları (F/K, PEG, PD/DD, EV/EBITDA…), temel veriler, gelir tablosu / bilanço / nakit akışı, kazanç geçmişi
- 📈 1Y / YTD / 1G getiriler ve fiyat grafiği: gece üretilen 10 yıllık kapanış cache'inden (`api/_data/prices/`, aşağıya bakın)
- 🏷️ CUSIP → ticker çözümleme (OpenFIGI)
- ⚖️ İki yönetici karşılaştırma (Jaccard ve ağırlıklı örtüşme, ortak pozisyonlarda Δ ve son çeyrek yönü, sektör kıyası, devir) + 2-3 hisse karşılaştırma (usta sayısı, usta $ değeri, net alım, 1Y/YBB, rasyolar); ücretsizde Berkshire vs Himalaya / AAPL-MSFT-GOOGL örneği SSR ile, kendi seçimi Pro. 📋 tarayıcı, ⭐ izleme listesi
- 🧭 **Süper Yatırımcı Konsensüsü** — seçili fonların birleşik görünümü: en çok tutulan, bu çeyrek en çok alınan/satılan, yeni pozisyon radarı
- 🎯 Opsiyon görünümü (PUT/CALL pozisyonları ayrı tablo + toplam ağırlıklar)
- 🧪 Kopyalama backtesti (deneysel): "13F'i her çeyrek kopyalasaydım" vs SPY — kapsam yüzdesi ve atlanan pozisyonlar açık; SPY serisi yoksa karşılaştırma gizlenir
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
| Veri | SEC EDGAR (submissions + full-text search + Archives), OpenFIGI, fiyat: FMP / TwelveData / Finnhub (canlı) + gece kapanış cache'i (Yahoo chart yalnız GitHub runner'dan, batch) |

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
- Ücretsiz katman sunucuda render edilir; Pro bölümler (tam tablolar, insider akışının tamamı, backtest) istemcide yüklenir. Kilitli her bölüm tek bileşenle gösterilir: `<ProGate>` (`client/src/components/ProGate.jsx`) — önizleme (ilk satırlar / örnek) sayfada kalır, kilit kutusu **altında** durur ve "Kalan N işlem Pro ile" der. /insiders ücretsizde: Piyasa Nabzı + Güçlü Sinyaller + En Büyük İşlemler kartları tam, Son İşlemler ilk 10 satır, rol/küme sekmelerinde ilk 5 (`/api/insider-feed` `full=1` olmadan önizleme; filtreler yok sayılır, CDN cache'lenir; `full=1` Pro ve `no-store`). /insiders/cluster, /csuite, /penny: ilk 10 satır.
- **ISR eşdeğeri (CDN cache):** fon/hisse/guru×hisse sayfaları `s-maxage=86400, stale-while-revalidate=604800` (günlük tazelenir, 7 gün eskisi sunulabilir); ana sayfa, konsensüs, sıralamalar ve insider sinyal sayfaları `s-maxage=3600` + 1 gün SWR; hesap/izleme listesi `no-store`. Politika `CACHE` sabitinde (`routes.js`).
- **Dil yolları:** her URL `/en/…` veya `/tr/…`. Öneksiz URL'ler 302 ile yönlenir: `lang` çerezi → Vercel ülke başlığı (`TR` → tr) → `Accept-Language` → en. `hreflang` en/tr/x-default her sayfada; canonical kendine işaret eder.
- **Slug'lar:** `api/_data/slugs.json` (`npm run slugs`) her 13F dosyalayıcı için kalıcı, ASCII, benzersiz slug tutar; `/manager/<cik>` 301 ile `/guru/<slug>` (küratörlü) veya `/filer/<slug>`'a gider. Bir kez atanmış slug asla değişmez; yeni çakışmalar CIK sonekiyle çözülür.
- `<head>`: `useSeo()` (client/src/seo.jsx) sunucuda toplanır, istemcide her gezinmede aynalanır. Şablonlar `client/src/lib/seoTemplates.js` (başlık/açıklama gerçek sayılarla, FAQ, breadcrumb, Organization/WebSite JSON-LD).

### Gerekli ortam değişkenleri

| Değişken | Zorunlu | Açıklama |
|---|---|---|
| `SITE_URL` | opsiyonel (`scripts/check-env.mjs` yalnız `*.vercel.app` değerinde build'i durdurur) | Canonical, hreflang, sitemap ve OG görsel URL'lerinin kökü, ör. `https://www.fundocap.co` (prod varsayılanı; `*.vercel.app` değerleri prod'da yok sayılır). Preview'da `VERCEL_URL`'den türetilir. |
| `SEC_USER_AGENT` | önerilir | SEC'in istediği iletişim bilgisi |
| `SEC_RPS`, `SEC_RETRY_BACKOFF` | opsiyonel | EDGAR istek hızı tavanı (batch'te 6/sn, Vercel'de 8/sn; 429/403/503'te otomatik yarıya iner, temiz koşuda toparlanır — `api/_lib/edgarClock.js`) ve retry bekleme süreleri (sn, virgülle). |
| `EDGAR_CACHE_DIR` | opsiyonel | EDGAR belge cache'i (varsayılan `.cache/edgar`, git dışı; boş string kapatır; Vercel'de kapalı). Aynı accession ikinci kez indirilmez; Action'da `actions/cache` ile koşular arası korunur. |
| `GURU_HISTORY_DRY`, `GURU_HISTORY_INCREMENTAL`, `GURU_HISTORY_FORCE` | opsiyonel | history yürüyüşü: kuru koşu planı (istek/cache/dakika), artımlı okuma (varsayılan açık), zorunlu tam okuma. |
| `STOCK_UPSTREAM_MS`, `STOCK_SNAPSHOT_MS` | opsiyonel | /api/stock sağlayıcı yarışı bütçesi (ms; varsayılan 3000, snapshot varken 1500). |
| `OPENFIGI_API_KEY` | önerilir | CUSIP→ticker |
| `FMP_API_KEY`, `TWELVEDATA_API_KEY`, `FINNHUB_API_KEY` | en az biri | /api/stock fiyat sağlayıcıları (FMP 250/gün: tam tablo; TwelveData 800/gün ve Finnhub 60/dk: fiyat). Yahoo ve Stooq Vercel'den çalışmaz, zincirde yoktur. Aynı anahtarlar gece fiyat cache'ini de doldurur (`scripts/build-prices.mjs`) |
| `PRICES_YAHOO`, `PRICES_TD_BUDGET`, `PRICES_FMP_BUDGET`, `PRICES_FINNHUB_BUDGET`, `PRICES_MAX_AGE_DAYS`, `PRICES_DRY` | opsiyonel | gece fiyat cache'i: runner'dan Yahoo chart (varsayılan açık), sağlayıcı başına gecelik çağrı bütçesi (400 / 60 / 300), bayat sayılma eşiği (1 gün), kuru koşu. `CLOSES_FRESH_DAYS` (4): dosyadaki seri bu kadar günden tazeyse canlı sağlayıcı sorulmaz |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | prod'da zorunlu | sunucu tarafı plan kontrolü (`api/_lib/auth.js`); yoksa herkes çıkış yapmış sayılır, Pro kilitli; production build durur |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | prod'da zorunlu | aynı değerler, istemci paketine build'de gömülür (`client/src/lib/supabase.js`) |
| Stripe | ödeme için | bkz. docs/STRIPE-KURULUM.md |
| `RESEND_API_KEY`, `ALERT_FROM` | alert e-postası için | `scripts/send-alerts.mjs`; anahtar yoksa koşu eşleştirir ama göndermez |
| `SUPABASE_SERVICE_ROLE_KEY` | alert işi için | digest her kullanıcının alert'lerini okur, RLS ile çalışamaz |
| `HISTORY_STORE`, `HISTORY_SUPABASE_URL`, `HISTORY_SUPABASE_KEY` | tarihsel depo için | `HISTORY_STORE=1` olmadan okuma yolu dosyalardan devam eder |
| `SEC_FIXTURE_DIR`, `GURU_HISTORY_FILE`, `GURU_STOCKS_FILE`, `FILINGS_FILE` | yalnız test | çevrimdışı fixture'lar (`tests/fixtures`) |

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

- `/sitemap.xml` indeks; `/sitemap-pages.xml`, `-gurus.xml` (guru + alt sayfalar + guru×hisse), `-filers.xml`, `-stocks.xml` (usta setinin tuttuğu tüm semboller + evrenin en çok tutulanları), `-guides.xml`, `-insider.xml`; 50k URL'yi aşan aile `-<tür>-<n>.xml` parçalarına bölünür. Kök her zaman `api/_lib/site.js` kanonik origin'idir (`https://www.fundocap.co`); eski `13-f-radar-omega.vercel.app` ve `fundocap.co` apex, `vercel.json` ile aynı yola 301 döner. Hepsi `api/_handlers/sitemap.js` tarafından istek anında üretilir (6 saat CDN cache) — ayrıca "yeniden üretme" adımı yoktur; kaynak dosyalar (`slugs.json`, `universe.json`, `stocks.json`, `insiders-teaser.json`, `guru-history.json`) Action'larla yenilendiğinde sitemap kendiliğinden güncellenir. `lastmod` en son bildirim tarihinden gelir.
- `/robots.txt`: her şeye izin, `/api/` ve hesap/izleme listesi yolları hariç; sitemap indeksini gösterir.
- `/api/og?type=guru&cik=…` ve `/api/og?type=stock&ticker=…` 1200×630 PNG üretir (resvg + paketlenmiş DejaVu Sans); diğer sayfalar varsayılan kartı kullanır.

### Önceden hesaplanan veriler (Action'lar)

| Dosya | Üreten | Sıklık | İçerik |
|---|---|---|---|
| `client/public/consensus.json`, `api/_data/consensus-pro.json` | `scripts/build-consensus.mjs` | günlük | en çok tutulanlar, alım/satımlar, yönetici güncelleme kartları |
| `api/_data/guru-history.json` | `scripts/build-guru-history.mjs` | günlük | 40 çeyrek: çeyreklik geçmiş, elde tutma süresi, guru×hisse serileri. Yalnızca herhangi bir çeyrekte ilk 100'e giren pozisyonlar saklanır (`GURU_HISTORY_TOP`); EDGAR'dan eksik gelen guru bir önceki koşunun verisini korur |
| `api/_data/splits.json` | `scripts/build-splits.mjs` | günlük | bölünme olayları (adetler split-adjusted) |
| `client/public/insiders-teaser.json`, `api/_data/insiders.json` | `scripts/build-insiders.mjs` | günlük | Form 4 akışı; sınıflandırma: güçlü sinyal / likidite / gürültü, 10b5-1 bayrağı |
| `client/public/universe.json`, `universe-summary.json`, `api/_data/slugs.json` | `scripts/build-universe.mjs` + `build-slugs.mjs` | haftalık | tüm 13F evreni ve slug tablosu |
| `api/_data/guru-stocks.json` | `scripts/build-consensus.mjs` | günlük | menkul bazında guru sahipliği: sıra, tutan fon sayısı, ağırlıklar, çeyrek aktivitesi (`netActivity()`), `exited` (panelin tamamen çıktığı isimler), `quarter`, `coverage`, PUT/CALL satırları |
| `api/_data/security-master.json` (+ türetilen `cusip-tickers.json`) | `build-consensus.mjs`, `build-guru-history.mjs`, `build-universe.mjs` (`securityMaster.persist`) | her build | CUSIP/CINS → {ticker, name, exchange, figi, validFrom/To, source}; çözülemeyenler deneme sayısı ve tarihiyle, günlük yeniden denenir (`FIGI_RETRY_BUDGET`) |
| `client/public/guru-activity.json` (+ çeyrek dosyaları) | `scripts/build-guru-activity.mjs` | günlük | /report pivotu: en yeni çeyrek `guru-stocks.json`'dan (rankings ile aynı satırlar), eski çeyrekler history'den aynı panel + aynı fonksiyonla; `coverage` çeyrek başına |
| `api/_data/sector-map.json` | `scripts/build-consensus.mjs` | günlük (artımlı) | ticker→sektör; her koşuda en çok `SECTOR_BUDGET` yeni sembol sorulur |
| `client/public/filings.json`, `client/public/filer-states.json`, `api/_data/filer-meta.json` | `scripts/build-filings.mjs` | günlük | 13F bildirim akışı (13F-HR / 13F-HR/A), bildirilen dönem, fon adresleri |

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
2. [vercel.com](https://vercel.com) → **Add New → Project** → GitHub'dan `mustafakocer/Fundocap` reposunu import edin.
3. Ayarlara dokunmanıza gerek yok — `vercel.json` her şeyi tanımlıyor (client build + `api/` fonksiyonları + SPA rewrites). Framework sorusuna **Other** deyin.
4. **Deploy** butonuna basın. İlk build ~2 dk sürer.
5. Environment Variables — `SITE_URL` production'da varsayılan olarak `https://www.fundocap.co` alınır; ayarlarsanız `*.vercel.app` olmamalı (build durur). Diğerleri:
   - `SEC_USER_AGENT` → `Fundocap/1.0 (sizin@email.com)` — SEC, istekler için iletişim bilgisi ister.
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

### Veritabanı yedeği ve geri yükleme

`.github/workflows/db-backup.yml` her pazartesi (ve elle) canlı Supabase'in
`public` şemasını ve `auth.users` tablosunu (şifre hash'leri dahil) `pg_dump`
ile alır, `BACKUP_PASSPHRASE` ile şifreler, 90 gün saklanan bir artifact
olarak yükler. Secret'lar: `SUPABASE_DB_URL` (session pooler adresi),
`BACKUP_PASSPHRASE`. Ayrıntı: `docs/SUPABASE.md` §5.

**Yedekten geri yükleme** (boş bir Postgres'e):

```bash
gpg -d -o backup.sql fundocap-<zaman>.sql.gpg                                   # 1. passphrase sorar
createdb restore && psql restore -c "create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;"   # 2. API rolleri
psql -v ON_ERROR_STOP=0 -q restore -f backup.sql                                # 3. public + auth.users
psql restore -c "select count(*) from public.profiles; select count(*) from auth.users;"   # 4. say
# 5. Canlıya dönüş: aynı dosyayı SUPABASE_DB_URL'e uygula; auth.users satırlarını Supabase Auth'un
#    tablosuna `insert … on conflict (id) do nothing` ile taşı (şema ve roller orada zaten var).
```

### 13F-HR/A (düzeltme) bildirimleri ve etkin çeyrek

Bir 13F-HR/A ayrı bir çeyrek değil, aynı dönemin 13F-HR'ına düzeltmedir. Cover page'deki `amendmentType` iki değer alır: **RESTATEMENT** (tablonun tamamı yeniden verilir → orijinalin *yerine* geçer) ve **NEW HOLDINGS** (yalnız eksik bırakılan pozisyonlar → orijinale *eklenir*). Eskiden `list13F` "çeyrek başına en son dosyalanan belge" diyerek 4 satırlık bir NEW HOLDINGS düzeltmesini çeyreğin kendisi sanıyordu (Berkshire 2025 Q1 = 4 pozisyon, 2023 Q3/Q4 = tek satır Chubb; devir %200, AAPL "1.3 yıl").

- `api/_lib/amendments.js`: saf mantık — `effectiveFilings` (CIK, dönem) başına tek giriş, sıralama **dönem tarihine** göre; `parseCoverPage` (`periodOfReport`, `amendmentType`); `applyAmendment` / `effectiveSnapshot`. Tip okunamazsa tablo boyutundan çıkarılır (orijinalin yarısından fazla satır → restatement) ve `inferred: true` işaretlenir.
- `api/_lib/sec.js`: `list13FAll` ham liste (denetim), `list13F` etkin liste (`amendments` ekli), `getEffectiveHoldings(cik, filing)` = orijinal + sıralı düzeltmeler, `fetchCoverPage`. **Tüm türev hesaplar** (holdings, consensus, guru-history, aum-history, manager-stats, position-history, backtest, stock-ownership, universe snapshot) yalnız etkin snapshot'tan beslenir; ham accession `getHoldings` ile ayrıca okunabilir.
- **Devir tanımı** tek yerde, `api/_lib/turnover.js`: `(açılan pozisyon değeri + kapatılan pozisyonların önceki değeri + ortak pozisyonlarda |Δadet| × fiyat) / iki çeyreğin ortalama portföy değeri`. Fiyat hareketi devir sayılmaz; herhangi bir işlem olan çeyrek asla "%0" göstermez (`<0.1%`). `newCount`/`exitCount` aynı fonksiyondan gelir.
- **Elde tutma süresi** ve devir security master ticker'ı üzerinden sayılır (CUSIP değişimi kırılma/işlem değildir; `api/_lib/securityMaster.js`). `/api/guru-history` saklı ham CUSIP'leri okuma anında master ile çözer, çözülemeyeni 13F `nameOfIssuer` ile gösterir.
- UI: "(A)" satırı yok; düzeltme uygulanan çeyrek `✎` ve "Düzeltme içerir (13F-HR/A, tarih)" rozeti taşır; `/filings` HR/A satırları dönem, tür (yeniden beyan / yeni pozisyonlar) ve tablo satır sayısını gösterir (`FILINGS_AMEND_BUDGET`, varsayılan 150/koşu).
- **Yeniden hesaplama (backfill):** `npm run rebuild` (`--dry` planı ve maliyeti yazar; `--only=history,consensus`; `REBUILD_CIKS=…`). Guru geçmişi parmak izi `v2|…` sürümlü olduğu için eski format girişler kendiliğinden tam okunur; elle tetiklemek için `Build consensus & returns → force_history`. Yürüyüş artımlıdır (`api/_lib/historyPlan.js`: yalnız belge seti değişen dönemler + öncesindeki 1 dönem) ve EDGAR belgeleri disk cache'inden okunur (`.cache/edgar`, Action'da `actions/cache`); `GURU_HISTORY_DRY=1` istek sayısını, cache oranını ve tahmini dakikayı önceden yazar. Cache soğukken tam koşu ≈ 7.5k belge / 6 rps ≈ 22 dk; sonraki geceler <100 istek.

### Usta yatırımcı seti, net alım/satım ve kapsam satırı

- **Tek kayıt:** `api/_lib/gurus.js` — 100 fon; `category`, `activeFrom/activeTo` (kapanan fon silinmez, "takip edilen" sayılmaz), `consensus:false` (geniş/kantitatif defter, konsensüs oyu değil), `history:false`. `client/src/data/popular.js` ve `api/_lib/consensusList.js` buradan re-export eder.
- **Tek hesap:** `api/_lib/netActivity.js` — net_$ = Σ_fon (adet_t − adet_{t−1}) × dönem sonu fiyat (Σdeğer_t/Σadet_t); yeni pozisyon tamamıyla, çıkış önceki adedin tamamı, fiyat hareketi işlem değil. `consensusBuild` (anasayfa, /consensus, /rankings, hisse sayfası) ve `build-guru-activity` (/report) yalnız bunu kullanır; `tests/net-activity.test.mjs` üç çıktıyı ticker bazında karşılaştırır.
- **Kapsam:** her dosyada `coverage = { quarter, tracked, filed, included, excluded: { not-filed, wide-book } }`; `<CoverageLine>` anasayfa, /consensus, /rankings/*, /report ve /calendar'da aynı cümleyi basar ("98 usta takip ediliyor · 82'si 2026 Q2 bildirdi · 72'si hesaba dahil — …").

### Kapanış serileri: gece cache'i (`api/_data/prices/`)

Backtest, fiyat grafiği (`/api/chart`), getiri kolonları (`/api/returns`, `returns.json`) ve AUM akış tahmini aynı seriyi okur: `dailyCloses(symbol)` (`api/_lib/providers.js`) önce `api/_data/prices/{SYMBOL}.json` dosyasına bakar (10 yıl günlük kapanış, sembol başına bir dosya; tarihler gün farkı olarak, kapanışlar gerekli hassasiyetle — `api/_lib/priceStore.js`), seri `CLOSES_FRESH_DAYS` içindeyse doğrudan cevaplar; bayatsa yalnız eksik günleri canlı sağlayıcıdan (FMP → TwelveData, kota ve devre kesici `providerHealth` üzerinden) ister; hiç dosya yoksa canlı; o da yoksa `null` (sayfa "seri yok" der, 0 basmaz). Dosyaları **Build consensus & returns** akışındaki `scripts/build-prices.mjs` üretir: evren = `guru-stocks.json` sembolleri + çıkılanlar + SPY/QQQ/IWM; artımlı (dosyadaki seri yalnız son kapanışından bu yana çekilir); log gece planıyla açılır (eksik / bayat / taze sayıları, bu gece hangi sağlayıcıdan kaç çağrı, tam dolum kaç gece). Kaynak sırası: Yahoo chart (runner'dan cevaplıyor, kotasız, ilk gece evrenin büyük kısmını doldurur) → TwelveData (dakikada 8, gecede `PRICES_TD_BUDGET`) → FMP (küçük dilim) → Finnhub candle (ücretsiz planda 403; ilk 403'te o gece için düşer). `api/_data/prices/_index.json` kapsamı özetler; `/api/diag` `priceCache` alanında gösterir; audit `prices` anahtarıyla denetler. Backtest cevabı `coverage` (simüle edilen ağırlık payı), `skipped` (atlanan pozisyonlar ve nedeni) ve `benchmark` (SPY serisi yoksa `null`) taşır; kapsam %70'in altındaysa sayfa sarı uyarı basar.

### Fiyat sağlayıcı zinciri (`/api/stock/:ticker`)

Yalnız anahtarlı sağlayıcılar (FMP → TwelveData → Finnhub) bütçe içinde **aynı anda** yarışır; en iyi sıralı cevap bütçe dolunca (ya da en üst sıradaki gelince) döner, kalanı arka planda cache'i günceller. Yahoo (üç uç da Vercel IP'lerinden 429) ve Stooq (CSV yerine JS-challenge HTML) zincirden kalıcı olarak çıkarıldı. Üst üste 3 kez düşen sağlayıcı 5 dakika atlanır; günlük kotalı bir sağlayıcının 429'u onu UTC gece yarısına kadar "quota" yapar, kotasının %90'ına gelen sağlayıcı ("conserve") kotası olan bir eş varken bekletilir, tek başına kaldığında yine sorulur (`api/_lib/providerHealth.js`; sayaçlar instance başına, alt sınır). Her cevapta:

| Başlık | Anlam |
|---|---|
| `X-Stock-Source` | `live` / `stale` (bu instance'ın son canlı cevabı) / `snapshot` (gece kapanışı, `priceStale`) / `none` |
| `X-Stock-Provider` | cevabı veren sağlayıcı |
| `X-Stock-Chain` | sağlayıcı başına sonuç: `ok:ms` ya da `throttle` / `forbidden` / `timeout` / `parse` / `upstream` / `network`; çağrılmadıysa `key` / `open` (devre kesici) / `quota` (gün bitti) / `conserve` |
| `X-Stock-Served` | instance başından beri dağılım: `live=…,stale=…,snapshot=…,none=…` |

`/api/diag` bölgeden ham probe'ları, hangi anahtarların tanımlı olduğunu, `quota` (limit, bugün kullanılan, bugün 429 sayısı, son 429, exhausted/conserve) ve sağlayıcı sağlığını döner. Function log'unda satır başına: `stock AAPL: <sağlayıcı> <sınıf> in <ms>: <hata>` ve `stock AAPL: served <kaynak> (<sağlayıcı>) in <ms> [<zincir>] totals …`.

### Tarihsel depo (opsiyonel, henüz doldurulmadı)

`supabase/history-schema.sql` 2013'ten itibaren tam holding geçmişi için tablo
şemasını tanımlar; `scripts/backfill-13f.mjs` EDGAR çeyreklik indekslerinden
yeniden başlatılabilir şekilde doldurur (imleç `backfill_state` tablosunda,
her koşu yenisinden eskiye doğru sınırlı sayıda çeyrek okur, yarıda kalan
çeyrek bir sonraki koşuda yalnızca eksik bildirimleri okur).

Okuma yolu (`api/_lib/holdingsStore.js`) yalnızca `HISTORY_STORE=1` iken
devreye girer ve her hata durumunda EDGAR'a düşer — yani depo boşken, backfill
sürerken ve bittikten sonra site aynı şekilde çalışır.

```bash
psql "$DATABASE_URL" -f supabase/history-schema.sql
BACKFILL_DRY=1 npm run backfill        # ne okuyacağını yazar, hiçbir şey yazmaz
BACKFILL_QUARTERS=4 npm run backfill   # sınırlı bir koşu
```

Kaba büyüklük: 2013+ için ~115 milyon pozisyon satırı. Tek koşuda bitmez,
tasarım gereği defalarca çalıştırılır.

### Notlar / Bilinen Sınırlar
- Yahoo Finance resmi olmayan API'dir; nadiren crumb/cookie yenilemesi gerekir (client otomatik dener).
- Çok büyük dosyalamalar (ör. Citadel, binlerce pozisyon) ilk yüklemede yavaş olabilir; sonuçlar edge + bellek cache'iyle hızlanır.
- 2023 öncesi 13F değerleri bin dolar cinsindendir; dönüşüm otomatik yapılır (`valueMultiplier`).
- Popüler yönetici listesi `client/src/data/popular.js` içinde düzenlenebilir.
