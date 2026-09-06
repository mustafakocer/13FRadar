# 13F Radar Denetim Raporu

**Tarih:** 3 Eylül 2026 · **Commit:** `3921acc` · **Dal:** `claude/13f-intelligence-features-nejb1h`

Kod incelemesi, canlı site testi (GitHub Actions runner'ından `curl`) ve veri dosyası analizi bir arada. Her bulguda dosya/satır, somut senaryo ve önerilen düzeltme var. Sıralama önem derecesine göre.

| Kritik | Yüksek | Orta | Düşük | Doğrulandı |
|---:|---:|---:|---:|---:|
| 3 | 8 | 15 | 12 | 12 |

## Özet karar

Veri omurgası sağlam: Berkshire portföyü ham SEC dosyasıyla kuruşuna kadar tutuyor, ödeme duvarı sunucuda üç uç noktada doğru çalışıyor, Supabase RLS kullanıcıların kendi planını değiştirmesine izin vermiyor. Ürünü satışa açmadan önce kapatılması gereken üç şey var:

1. **Ödeme webhook'u** her başarılı tahsilatta kullanıcıyı Free'ye düşürüyor ve imza doğrulaması yok.
2. **Pro içerik** büyük ölçüde sadece arayüzde gizli; veri herkese açık JSON ve API'de duruyor.
3. **Ücretli veri kotaları** anonim isteklerle dakikalar içinde tüketilebiliyor; canlı testte grafik ve getiri uç noktaları bu yüzden boş döndü.

---

## Kritik

### K1 · Başarılı ödeme olayları kullanıcıyı Free'ye düşürüyor
`api/_handlers/ls-webhook.js:26-34`

- **Neden:** Kod `subscription_` ile başlayan her olayı abonelik olayı sanıyor. Lemon Squeezy'nin `subscription_payment_success`, `subscription_payment_recovered` gibi olaylarında `data.attributes.status` bir fatura durumu taşır (`paid`). Bu değer `ACTIVE_STATUSES` içinde olmadığından `setUserPlan(userId, 'free')` çağrılıyor.
- **Senaryo:** Kullanıcı Pro alır. Önce `subscription_created` (plan → pro), saniyeler sonra `subscription_payment_success` (plan → free) gelir. Son işlenen kazanır. Her aylık yenilemede aynı yarış tekrarlanır.
- **Düzeltme:** Yalnızca `subscription_created / updated / resumed / unpaused / cancelled / expired / paused / plan_changed` olaylarını işle; `subscription_payment_*` olaylarını 200 ile yoksay. `ends_at`'i yalnızca iptalde kullan.

### K2 · Webhook imza doğrulaması yok, gizli anahtar URL'de
`api/_handlers/ls-webhook.js:11-13`

- **Neden:** Tek koruma `?secret=` sorgu parametresi. Lemon Squeezy'nin gövde üzerinden ürettiği `X-Signature` HMAC-SHA256 başlığı kontrol edilmiyor. Sorgu parametresi Vercel günlüklerinde ve LS panelinde düz metin kalır.
- **Senaryo:** URL'yi gören herkes kendi Supabase kullanıcı kimliğini `meta.custom_data.user_id` içine koyup POST atarak kendini Pro yapar ya da başka kullanıcıyı Free'ye düşürür.
- **Düzeltme:** Ham gövde üzerinde HMAC hesapla, `crypto.timingSafeEqual` ile `X-Signature` ile karşılaştır. Sorgu parametresini kaldır. `user_id` için UUID biçim kontrolü.

### K3 · Pro özelliklerin çoğu sadece arayüzde kilitli, veri herkese açık
`client/src/auth.jsx:103` · `components/HoldingsTable.jsx:101` · `pages/Screen.jsx:158,319` · `pages/Consensus.jsx:131` · `pages/Stock.jsx:92,109` · `pages/Compare.jsx:217`

- **Neden:** Sunucuda yalnızca `backtest`, `position-history`, `stock-ownership` 402 döndürüyor. Geri kalan her Pro özellik bir React state'ine (`plan === 'pro'`) bağlı: tam portföy tablosu (`slice(0,10)`), fon filtreleri (`pointerEvents:none`), Usta Yatırımcılar alım/satım listeleri, içeriden işlemler, 13D/G, karşılaştırma, Excel.
- **Senaryo:** Giriş yapmadan `curl /consensus.json` alım/satım/yeni pozisyon listelerinin tamamını verir. `/api/holdings/:cik/:acc` tüm pozisyonları döndürür. React DevTools'ta `plan` değerini `pro` yapmak her kilidi açar.
- **Düzeltme:** Free için `holdings` yanıtını 10 satır + toplam sayı olarak kırp. `consensus.json`'u herkese açık kısım (en çok tutulanlar) ve `requirePro` arkasındaki kısım olarak böl. `insiders` ve `filings13dg`'ye `requirePro` ekle. Arayüz kontrolleri yalnızca UX olarak kalsın.

---

## Yüksek

### Y1 · Anonim istekler günlük FMP ve Twelve Data kotasını dakikalar içinde bitirebilir
`api/_handlers/stock.js:238-272` · `returns.js:18-28` · `backtest.js:46-52` · `api/index.js` (hız sınırı yok)

- **Neden:** IP başına sınır yok, `ticker` doğrulanmıyor. Önbelleksiz her sembol için `stock` 4 FMP çağrısı, `returns` sembol başına 1 çağrı (istek başına 60 sembol), `backtest` 150'ye kadar fiyat serisi çeker.
- **Senaryo (canlı test):** `/api/stock/%3Cscript%3E` 15 sn sürdü ve 502 döndü. `/api/returns` 40 sembollük tek istekte 48 sn çalışıp 34 sembol için ayrı ayrı sağlayıcıya gitti. 60 rastgele sembol FMP'nin 250'lik günlük kotasını bitirir.
- **Düzeltme:** `/^[A-Z0-9.\-]{1,10}$/` sembol doğrulaması; bilinmeyen sembolleri `stocks.json` + SEC ticker listesine karşı kontrol; IP başına token-bucket (dakikada 30); `returns` uç noktasını statik dosya dışındaki semboller için kapat.

### Y2 · Gece Action'ı ile canlı site aynı Twelve Data anahtarını paylaşıyor
`.github/workflows/consensus.yml:31` · `scripts/build-consensus.mjs:61-77` · `api/_lib/providers.js:69-86`

- **Neden:** Action dakikada 7 kredi harcayarak ~1 saat çalışıyor; TD'nin dakikalık limiti 8. Bu sürede canlı sitenin TD yedeği 429 alıyor.
- **Senaryo (canlı test, Action çalışırken):** `/api/chart/AAPL` → 502 "Stooq data unavailable"; `/api/returns?symbols=AAPL,MSFT` → `{}`; `/api/stock/AAPL` FMP kotası dolduğu için rasyosuz TD verisine düştü.
- **Düzeltme:** Action için ayrı TD anahtarı ya da dakikada 5'e düşür. Daha iyisi: grafik kapanışlarını gece üretip statik servis et.

### Y3 · 13F-HR/A düzeltmeleri orijinal dosyanın yerine körlemesine geçiyor
`api/_lib/sec.js:26-45` · `scripts/build-universe.mjs:50-56`

- **Neden:** `list13F` aynı dönem için en son gönderilen dosyayı seçiyor. SEC'de iki düzeltme türü var: **RESTATEMENT** (tam yeniden beyan) ve **NEW HOLDINGS** (sadece eklenen satırlar). İkincisi seçilince portföy birkaç pozisyondan ibaret görünür. `primary_doc.xml` içindeki `amendmentType` okunmuyor.
- **Senaryo:** 3.000 pozisyonluk fon 2 pozisyon ekleyen /A gönderir → AUM ve pozisyon sayısı 2 görünür, çeyrek karşılaştırması 2.998 "kapatılan pozisyon" üretir. `universe.json`'da AUM'u 0 olan 102 fon var.
- **Düzeltme:** `amendmentType` oku; NEW HOLDINGS ise orijinalle birleştir, RESTATEMENT ise değiştir. AUM 0 fonları "veri eksik" işaretle.

### Y4 · Yahoo çoğu zaman engelli ama her çağrı önce onu 4 kez deniyor; sektör grafiği üretimde dolmuyor
`api/_lib/yahooClient.js:68-96` · `stock.js:240` · `chart.js:18` · `returns.js:8` · `sectors.js:17-19`

- **Neden:** Her önbelleksiz çağrı çerez + crumb alıp 4 deneme ve ~4 sn bekleme yapıyor, sonra FMP'ye geçiyor. `/api/sectors` yalnızca Yahoo'ya bağlı, yedeği yok.
- **Senaryo (canlı test):** `/api/stock/AAPL` önbelleksiz 12 sn. Yahoo dün iki host'ta 429, bugün 200 (kararsız). `/api/sectors` 40 sembol için 39 sn çalışıp hepsini null döndürdü.
- **Düzeltme:** Devre kesici (bir 429 sonrası 15 dk deneme yok). Sektörü FMP `profile`'dan al ya da gece `stocks.json`'a yaz.

### Y5 · Portföy önbelleği istemcinin gönderdiği tarihle zehirlenebilir
`api/_handlers/holdings.js:10,14` · `api/_lib/sec.js:115-125`

- **Neden:** `?fd=` doğrudan `valueMultiplier`'a gidiyor ama önbellek anahtarı `hold:cik:acc` tarihi içermiyor.
- **Senaryo:** `/api/holdings/1067983/0001193125-26-352200?fd=2000-01-01` → Berkshire AUM'u 7 gün (CDN'de 6 saat) 299 trilyon $ görünür.
- **Düzeltme:** İstemci `fd`'sini yoksay, tarihi `submissions`'tan türet; ya da anahtara ekle.

### Y6 · Sembol eşlemesi eksik: statik CUSIP haritası 6.000 yerine 470 kayıt; Berkshire getirisi yok
`api/_data/cusip-tickers.json` · `scripts/build-universe.mjs:122-143` · `api/_lib/figi.js:20-25` · `client/public/returns.json`

- **Neden:** Haftalık Action 6.000 CUSIP hedefliyor ama dosyada 470 kayıt var (anahtarsız OpenFIGI 25 istek/dk). Sağlayıcı biçimleri farklı: FIGI `BRK-B`, Twelve Data `BRK.B`.
- **Senaryo:** Sembolsüz satır oranı: yeni pozisyonlar 17/40, en çok alınanlar 4/20, en çok tutulanlar 3/30, stocks.json 30/500. `returns.json` 395 sembol içeriyor ama `BRK-B` yok.
- **Düzeltme:** Universe Action günlüğünde FIGI adımını kontrol et; `OPENFIGI_API_KEY` secret'ının ulaştığını doğrula. Sağlayıcı başına sembol normalize fonksiyonu.

### Y7 · Ortak bilgisayarda takip listeleri hesaplar arasında karışıyor; çıkış temizlemiyor
`client/src/auth.jsx:38-55,96`

- **Neden:** Her oturum olayında yerel `favorites13f` ile bulut listesi birleştirilip mevcut kullanıcıyla geri yazılıyor. Çıkışta localStorage ve Query önbelleği silinmiyor. Birleştirme `TOKEN_REFRESHED`'de de çalışıyor.
- **Senaryo:** A girer, çıkar; B aynı tarayıcıdan girer → A'nın favorileri B'nin bulut listesine yazılır. B 30 dk boyunca A'nın Pro yanıtlarını önbellekten görebilir.
- **Düzeltme:** Birleştirme yalnızca `SIGNED_IN`'de; `SIGNED_OUT`'ta localStorage temizliği + `queryClient.clear()`; yerel favorileri kullanıcı kimliğiyle anahtarla.

### Y8 · Hisse bölünmeleri sahte "büyük alım" olarak görünüyor
`api/_lib/consensusBuild.js:64-72` · `stock-ownership.js:61` · `components/ChangeStory.jsx`

- **Neden:** Çeyrekler arası karşılaştırma ham hisse adedi üzerinden; bölünme düzeltmesi yok.
- **Senaryo:** NVDA 10:1 bölünme çeyreğinde pozisyonu koruyan her fon "+%900 artırdı" görünür; `buyValue` 9 kat şişer.
- **Düzeltme:** `(shares/prevShares)` ile `(prevPx/px)` yakın tam sayı oranındaysa bölünme kabul et; ya da değişimi ağırlık üzerinden raporla.

---

## Orta

| # | Bulgu | Konum | Düzeltme |
|---|---|---|---|
| O1 | Usta Yatırımcılar farklı çeyrekleri karıştırıyor (Berkshire 2026-06-30, Pershing "yeni pozisyonları" 2026-03-31). | `consensusBuild.js:9-23` | Dönem etiketi; bir çeyrekten eski fonları hariç tut |
| O2 | Bölgesel fiyat (10 $) atlatılabiliyor: dört ödeme URL'si pakette, `/api/geo` DevTools'ta değiştirilebilir. | `Pricing.jsx:29-33` · `geo.js` | LS tarafında ülke kısıtı ya da sunucuda imzalı bağlantı |
| O3 | Girdi doğrulaması eksik; hata gövdeleri üst sağlayıcı mesajını iletiyor. Canlı: `holdings/1067983/foo` 7,5 sn sonra 502; 29 haneli CIK 502; `search?q=<img>` SEC 403'ünü iletti. | `holdings.js:8` · `manager.js:4` · `position-history.js:12` · `search.js:10` | Accession `^\d{10}-\d{2}-\d{6}$`, CIK ≤ 10 hane, CUSIP 8-9 alfasayısal; ağ çağrısı öncesi 400 |
| O4 | Güvenlik başlıkları yok: yalnızca HSTS var. `X-Content-Type-Options`, `frame-ancestors`, `Referrer-Policy`, CSP eksik (clickjacking). | `vercel.json` | `headers` bloğu |
| O5 | `/api/diag` herkese açık; her çağrıda 6 dış istek, üst sağlayıcı durumlarını gösteriyor. | `diag.js` | Kaldır ya da token iste |
| O6 | Fon → fon geçişinde `selAcc` kalıyor → "Cannot read properties of undefined (reading 'filingDate')". | `Manager.jsx:42,48-54` | `<Manager key={cik}/>` |
| O7 | 404 sayfası ve ErrorBoundary yok; `fmtPct("12.5")` fırlatır; "Omaha, null". Bilinmeyen URL 200 boş alan. | `App.jsx:83-94` · `format.js:21,28,34` · `Manager.jsx:181` | `path="*"`, ErrorBoundary, `Number()` + `isFinite` |
| O8 | `getSession()` catch'siz → sonsuz spinner; 402 çoğu yerde ham "pro-required" metni; 5 dk plan önbelleği uyuşmazlığı. | `auth.jsx:52` · `api.js:6-17` · `api/_lib/auth.js:48` | `.catch`, tipli `PaywallError`, webhook sonrası önbellek geçersizleme |
| O9 | 982 KB tek JS paketi; Recharts ve supabase-js ana sayfada iniyor; uyarı eşiği 900 KB'a çekilmiş. | `App.jsx` · `vite.config.js:13` | `React.lazy`, `manualChunks` |
| O10 | 5-8 bin satırlı tablolar sanallaştırılmadan çiziliyor (Morgan Stanley 8.402 pozisyon → ~85k DOM düğümü). | `HoldingsTable.jsx:101,149-212` · `Screen.jsx:347-349` | `@tanstack/react-virtual` ya da 200 satır sayfalama |
| O11 | SEC'e küresel hız sınırı yok; önbelleksiz fon sayfası 30+ SEC isteği; takip listesi 60 paralel çağrı. 10 istek/sn aşılırsa tüm Vercel IP'si 403 alır. | `aum-history.js:19-22` · `manager-stats.js:17-26` · `Watchlist.jsx:14-20` | `sec.js`'de tek kuyruk (8/sn), toplu uç nokta |
| O12 | Backtest iyimser: fiyatı bulunamayan pozisyonlar düşürülüp normalize ediliyor (hayatta kalan yanlılığı), temettü yok, `coverage` açıklanmıyor. İleriye bakma hatası yok (dönem sonu + 46 gün doğru). | `backtest.js:76-88` | Kapsama < %80 ise "güvenilmez"; yöntem notu |
| O13 | Erişilebilirlik: sıralanabilir başlıklar ve genişleyen satırlar klavyeyle ulaşılamıyor; palette odak tuzağı yok; `--faint #8b93a3` 3,09:1, `.badge.neg` 4,32:1; InfoTip `outline:none`. | `FilterSelect.jsx` · `CommandPalette.jsx` · `HoldingsTable.jsx:141,152` · `tokens.css` · `app.css:313` | `<button>` + `aria-sort`, `role="dialog"`, `--faint ≈ #6f7787` |
| O14 | Sözlük tam (391/391) ama `t()` dışı metinler ("E-posta", "8.000+"), `lang` özniteliği değişmiyor, `reco.strong_sell` ham anahtar, `pricing.trNote` ölü. | `i18n.jsx:872-873` · `Account.jsx:159` · `Stock.jsx:266` · `index.html:2` | `lang` güncelle, yedek metin, kalanları sözlüğe taşı |
| O15 | Hiç test, lint ve CI kontrolü yok; 13F ayrıştırma ve ×1000 kuralı için regresyon güvencesi yok. | `package.json` · `.github/workflows/` | Vitest + fixture'lar; push'ta build + lint |

---

## Düşük

| # | Bulgu | Konum | Düzeltme |
|---|---|---|---|
| D1 | Sayı/tarih biçimi dilden bağımsız (`en-US`); fiyat sayfasında "$19,90" ile "$199" karışık. | `format.js:4,15` · `Pricing.jsx:31` | `Intl.NumberFormat(lang)` |
| D2 | SEO: tek statik title/OG, `og:image`, canonical yok; `robots.txt` ve `sitemap.xml` SPA HTML'i döndürüyor; Safari data-URI favicon desteklemiyor. | `client/index.html` · `client/public/` | Statik robots/sitemap, PNG favicon |
| D3 | Karanlık mod sistem tercihini okumuyor; `color-scheme` meta yok. | `main.jsx:23` | `prefers-color-scheme` varsayılanı |
| D4 | Mobilde 8 menü çipi üç satır; InfoTip (240px) kenarlarda taşıyor. | `app.css:82-94,315-321` | Katlanır menü, sınırlı tooltip |
| D5 | Render sırasında yan etki: `markFilingSeen` her çizimde localStorage'a yazıyor. | `Manager.jsx:97` | `useEffect` |
| D6 | Excel dışa aktarımı null ağırlıkta sessizce patlıyor. | `exportExcel.js:10` | Koruma + toast |
| D7 | Sağlayıcıdan gelen `website` şema kontrolsüz `href`'e giriyor. | `Stock.jsx:506` | `/^https?:\/\//` |
| D8 | "Supabase yapılandırılmamış" dalları ulaşılamaz (fallback anahtarlar gömülü). | `auth.jsx:8-9,102` · `Pricing.jsx:94-105` | Ölü kodu kaldır |
| D9 | `xlsx 0.18.5` npm'de yamalanmamış iki CVE (prototype pollution, ReDoS); yalnızca yazma kullanıldığı için risk düşük. | `client/package.json` | SheetJS CDN sürümü ya da `exceljs` |
| D10 | GET uç noktaları POST/DELETE de kabul ediyor. | `api/index.js:48` | Webhook dışı rotalarda GET zorunlu |
| D11 | `remember()` haritası sınırsız büyüyor. | `cache.js:20-22` | LRU üst sınır |
| D12 | `/api/manager/../../` SPA HTML'ine düşüyor (zararsız). | `vercel.json` | API için JSON 404 |

---

## Canlı test sonuçları

Koşu 10 (2 Eylül 12:30 UTC, gece Action'ı çalışırken) ve koşu 11 (3 Eylül 16:01 UTC). Hedef: `13-f-radar-omega.vercel.app`.

| Test | Beklenen | Gözlenen | Sonuç |
|---|---|---|---|
| Berkshire portföyü vs ham SEC XML | Birebir | 299.253.556.246 $ = 299.253.556.246 $ · 89 satır → 29 pozisyon · ağırlık %100 | ✅ |
| Ödeme duvarı: token yok / bozuk / sahte JWT | 402 | 3 uç nokta × 3 durum = 9/9 402 | ✅ |
| 402 CDN'de önbellekleniyor mu | Hayır | `x-vercel-cache: MISS`, `max-age=0` | ✅ |
| Webhook GET / anahtarsız POST / yanlış anahtar | 405 / 401 / 401 | 405 / 401 / 401 | ✅ |
| CORS yabancı Origin | ACAO yok | API'de yok; kök HTML'de `*` | ✅ |
| `/api/stock/AAPL` | FMP rasyoları | 200 ama kaynak `twelvedata`, rasyolar boş, 12 sn | ⚠️ |
| `/api/chart/AAPL?range=1mo` (Action çalışırken) | Fiyat serisi | 502 "Stooq data unavailable" | ❌ |
| `/api/returns?symbols=AAPL,MSFT` (Action çalışırken) | Getiriler | `{}` | ❌ |
| `/api/returns` 40 sembol tek istek | Sınırlı fan-out | 34 yanıt, 48 sn, sembol başına ayrı çağrı | ❌ |
| `/api/sectors` 40 sembol | Sektör adları | 40/40 null, 39 sn | ❌ |
| Yahoo erişimi Vercel'den | Kararlı | Koşu 10: 429 · Koşu 11: 200 | ⚠️ |
| Güvenlik başlıkları | nosniff, frame-ancestors, referrer, CSP | Yalnızca HSTS | ❌ |
| `/api/diag` | 404/401 | 200 | ❌ |
| `/api/stock/<script>` | 400, ağ yok | 502, 15 sn | ❌ |
| `/holdings/1067983/foo` | 400 | 502, 7,5 sn | ❌ |
| Bilinmeyen sayfa | 404 | 200, boş ana alan | ⚠️ |
| Ağır uç nokta gecikmeleri (soğuk → sıcak) | < 3 sn | aum-history 5,3 → 0,2 · consensus API 3,7 → 0,2 · diğerleri < 1 sn | ⚠️ |
| Statik JSON sıkıştırma | br/gzip | Hepsi `content-encoding: br` | ✅ |
| `/robots.txt`, `/sitemap.xml` | Metin/XML | 200 ama index.html gövdesi | ❌ |
| Kaynak sızıntısı (`/api/index.js`, `/.env`, `/supabase/schema.sql`) | Yok | Hepsi SPA HTML'ine düşüyor | ✅ |
| Hata gövdesi sızıntısı | Genel mesaj | Yalnızca "Request failed with status code 404" | ✅ |
| Statik veri tazeliği | Güncel | consensus.json 03.09 10:05 · returns.json 395 sembol · universe.json 31.08, 7.830 fon | ✅ |

## Doğrulanan, sorun bulunmayan noktalar

- ×1000 kuralı doğru: dosyalama tarihi 2023-01-03 ve sonrası için 1, öncesi 1000.
- Backtest ileriye bakmıyor: dönem sonu + 46 gün.
- RLS: `profiles` tablosunda UPDATE ilkesi yok; kullanıcı kendi planını değiştiremez.
- Sunucu plan kontrolü kullanıcı token'ıyla Supabase'e sorup `plan_expires` kontrol ediyor.
- XSS sink'i yok (`dangerouslySetInnerHTML`, `innerHTML`, `eval` yok).
- Repoda yalnızca herkese açık Supabase anon anahtarı; `client/dist` ve `.env` izlenmiyor.
- Sözlük eksiksiz: TR/EN 391'er anahtar.
- `xlsx` tembel yükleniyor (ayrı 429 KB chunk).
- `universe.json` yalnızca /screen, `stocks.json` yalnızca /consensus sayfasında çekiliyor.
- Ödeme bağlantıları env boşken güvenli ("yakında" düşer).
- Yıllık fiyat matematiği doğru: 12 × 19,90 = 238,80 → "$238"; "2 ay ücretsiz" iki bölgede de tutuyor.
- TanStack Query varsayılanları makul.

## Öncelik sırası

1. **Webhook (K1, K2)** — payment olaylarını yoksay, HMAC doğrulama, UUID kontrolü. Yarım gün.
2. **Paywall'ı sunucuya taşı (K3)** — holdings 10 satır, consensus.json böl, insiders/13D/G'ye requirePro. Bir gün.
3. **Sağlayıcı katmanı (Y1, Y2, Y4)** — sembol regex, Yahoo devre kesici, IP hız sınırı, ayrı TD anahtarı, FMP'den sektör. Bir gün.
4. **Veri doğruluğu (Y3, Y5, Y6, Y8, O1)** — düzeltme türü, `fd` yoksayma, FIGI haritası, bölünme koruması, dönem etiketi. İki gün.
5. **İstemci dayanıklılığı (Y7, O6, O7, O8, O9)** — çıkış temizliği, Manager key, ErrorBoundary + 404, PaywallError, kod bölme. Bir gün.
6. **Test altyapısı (O15)** — sec.js fixture testleri, push'ta build kontrolü.
