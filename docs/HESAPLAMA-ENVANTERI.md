# Hesaplama envanteri — net alım/satım, usta seti, devir, CUSIP→ticker, sektör

2026-09-21, 2. paket (#5–#10) öncesi çekilen fotoğraf ve paket sonrası durum.
"Önce" sütunu kök nedeni gösterir; "Sonra" sütunu tek kaynağı.

## 1. Net alım/satım ($)

| Sayfa / çıktı | Endpoint / dosya | Fonksiyon | Fon seti | Fiyat / tanım (önce) | Sonra |
|---|---|---|---|---|---|
| Anasayfa "Çeyrek aktivitesi" (5 alım / 5 satım) | `client/public/consensus.json` → `mostHeld` | `Home.jsx MarketActivity` — **frontend'de** `mostHeld.filter(netValue>0)` | `CONSENSUS_MANAGERS` aktif (72) | `consensusBuild.js`: yeni = değer_t; ortak = Δadet × (değer_t/adet_t, fon bazında); çıkış = değer_{t−1} | `consensus.json.activity` (build'de `netActivity()` ile) |
| /consensus (alınanlar / satılanlar sekmesi) | `/api/guru-stocks?limit=500` (Pro: `/api/consensus`) | `consensusBuild.js` | 72 | aynı | `netActivity()` |
| /rankings/most-bought, most-sold | `/api/guru-stocks?limit=300` → `api/_data/guru-stocks.json` | `consensusBuild.js` (SSR seed `loadRankings`) | 72 | aynı | `netActivity()` |
| /stock/:ticker "guru sahipliği" kartı | `/api/guru-stocks?ticker=` | `guruStocks.js` okur | 72 | aynı | aynı tablo |
| /report (çeyrek pivotu) | `client/public/guru-activity.json` | `scripts/build-guru-activity.mjs` + `guruActivity.quarterDeltas` | **guru-history seti (85)**: `POPULAR ∪ CONSENSUS` − `history:false`; kapanmış fonlar dahil | **ticker bazında** toplam Δadet × (Σdeğer_t/Σadet_t); yalnız her çeyrek ilk-100'e giren pozisyonlar (`GURU_HISTORY_TOP`) | en yeni çeyrek `guru-stocks.json`'dan (aynı satırlar); eski çeyrekler history'den, **aynı fon paneli** ve aynı `netActivity()` |
| /reports/:id (statik rapor) | `api/_data/reports/*.json` | `scripts/build-report.mjs` ← `consensus-pro.json` | 72 | consensus | değişmedi (aynı kaynak) |
| /api/og?type=report | `og.js` | rapor JSON | 72 | consensus | aynı |
| llms.txt | `scripts/build-llms.mjs` | consensus.json | 72 | consensus | aynı |

Belirtinin kaynağı (SPCX): anasayfa/rankings 12 fon × yeni pozisyon = $15.14B (consensus paneli, 72 fon);
/report 18 fon = $22.28B (history seti, 85 fon: Bridgewater, Renaissance, Citadel, D.E. Shaw… dahil).
Fark = fon seti farkı; tanım (yeni pozisyon %100) her ikisinde aynı.

## 2. Usta yatırımcı seti sayısı

| Sayfa | Kaynak (önce) | Sayı (önce) | Sonra |
|---|---|---|---|
| Anasayfa chip listesi | `client/src/data/popular.js` (`POPULAR_MANAGERS`, 102 satır, 2 kapanmış) | ~100 | `api/_lib/gurus.js` → aktif + "(kapandı)" etiketi |
| /consensus "Takip edilen fon" | `consensus.json.managers` (bildirim yapmış aktif consensus paneli) | 72 | `coverage` satırı: 100 usta · 82 Q2 bildirdi · 72 hesapta |
| /rankings/* alt başlık | `guru-stocks.json.managers` | 72 | aynı `coverage` |
| /report alt başlık | `consensus.json.managers.length` (ama satırlar 85 fondan!) | 72 | `guru-activity.json.coverage` (aynı panel) |
| /calendar "bildirdi / takip" | `slugs.json` kind=guru (100) × `guru-history`/consensus reportDate | 82/100 | registry: aktif = takip; o çeyrekte bildirim = filed |
| /gurus | `/api/slug?kind=guru` | 100 | aynı (kapanmışlar etiketli) |
| build-guru-history | `POPULAR ∪ CONSENSUS` − `history:false` | 85 | registry `history !== false` |

## 3. Devir (turnover)

| Yer | Fonksiyon | Not |
|---|---|---|
| `api/_lib/turnover.js` | `turnover(prev, cur)` — (açılan + kapatılan + ortak \|Δadet\|×fiyat) / ort. portföy | tek tanım; anahtar CUSIP idi → **security master id (ticker)** |
| `scripts/build-guru-history.mjs` | her çeyrek | canlı `guru-history.json` **hâlâ eski koddan** (`fp` başında `v2\|` yok): düzeltmeler ayrı çeyrek, %185–200 devir, AAPL 5 çeyrek |
| `/api/manager-stats` (`managerHistory.js`) | `managerStatsFromGuru` | history dosyasından okur |
| Manager.jsx KPI + geçmiş tablosu | `fmtTurnover` | tooltip `tips.turnover` |
| /rehber/13f-sinirlari | — | paragraf eklendi |

## 4. CUSIP → ticker

| Yer | Kaynak (önce) | Sonra |
|---|---|---|
| `api/_lib/figi.js` `mapCusipsToTickers` | `api/_data/cusip-tickers.json` (5.925, düz map) + OpenFIGI canlı | `api/_lib/securityMaster.js` + `api/_data/security-master.json`; figi.js yalnız taşıma |
| `/api/holdings` pozisyon ticker'ları | figi | master |
| `guru-history.json` `positions[].ticker`, `quarters[].top10` | build anında figi; çözülmeyen ham CUSIP olarak **dosyada kalır** (H1467J104) | handler okuma anında master ile çözer; çözülmeyen → 13F `nameOfIssuer` |
| `related.json` `shared` | `e.ticker \|\| cusip` | handler okuma anında master |
| `consensusBuild.js`, `build-universe.mjs`, `build-filings.mjs`, `stockMetaBuild.js` | figi | master (aynı imza) |
| Elde tutma süresi | `idOf = ticker \|\| cusip` (build) | master id |

## 5. Sektör dağılımı

| Yer | Kaynak | Not |
|---|---|---|
| Guru sayfası Dağılım sekmesi | `/api/sectors?symbols=` → `sector-map.json.bySymbol` (SIC→sektör) + Yahoo `assetProfile` (bilinmeyen) | ETF → `null`; bileşen null'ı atıyordu; kapsanan alt kümeye normalize |
| /rankings, /screen/stocks filtreleri | `guru-stocks.json.sector` (`stockMetaBuild.applyStockMeta`) | |
| /report sektör sütunu | `guru-activity.json.rows[].sec` (sector-map) | |
| /stock profil | sağlayıcı `profile.sector`, snapshot `ticker-meta.sector` | |
| rapor `sectorFlow` | `null` (TODO) | değişmedi |
