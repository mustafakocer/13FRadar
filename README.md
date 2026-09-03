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
- 👤 İçeriden işlemler (Form 4) hisse sayfasında
- 🔔 İzleme listesinde yeni 13F rozetleri, ⌘K komut paleti, 🖨 PDF/yazdır raporu
- 🌍 Tam evren tarayıcı: haftalık GitHub Action tüm ~8.000 13F dosyalayıcısını tarayıp `client/public/universe.json` üretir
- 🌗 Açık/koyu tema, 🇹🇷/🇬🇧 çift dil

## Mimari

| Katman | Teknoloji |
|---|---|
| Frontend | React 18 + Vite + React Router v6 + TanStack Query v5 + Recharts |
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
6. Domain bağlamak isterseniz: Project → Settings → Domains.

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
