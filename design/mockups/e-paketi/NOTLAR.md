# E paketi mockup notları

Mockup'lar `build.mjs` ile gerçek veriden üretilir; rakamlar sabit değildir.

## Kararlar
- Menü → sayfa: Bugün `/bugun` · Ustalar `/gurus` · Fonlar `/screen` · Hisseler `/screen/stocks` · Insider `/insiders` · Sıralamalar `/rankings/most-bought` · 13F Takvimi `/calendar` · Takip Listem `/watchlist` · Karşılaştır `/compare` · Öğren `/rehber` (yeni rehber listesi).
- Girişli kullanıcı için `/` → `/bugun` yönlendirmesi yapılmayacak; Bugün menüden açılır.
- Tema: açık ve koyu ikisi de tam; varsayılan değişmedi.
- Şirket adları: `client/src/lib/label.js` (sunucu da aynı kuralı kullanır). Baş harfler öne alınır ("H.B. Fuller", "D.R. Horton"), marka yazımları ("Coca-Cola", "JPMorgan Chase"), küçük bağlaçlar ("Bank of America").
- Yönetici adları: `personName()` — Form 4'teki "SOYAD AD" sırası "Ad Soyad"a çevrilir ("Ryan Cohen").

## "Bu çeyrek ne yaptı" sayıları
Mockup'ın ilk sürümü 3 artırdı / 3 azalttı gösteriyordu: kaynağı `consensus.json` güncelleme kartlarıydı ve o kartlar her kategoride yalnız en büyük 3 satırı saklar (`api/_lib/consensusBuild.js`, `top(list, 3)`). Eşik değil, veri kesmesi. Canlı fon sayfası `/api/changes` → `holdingsChanges` → `portfolioChanges` zincirini kullanır; mockup artık aynı kütüphaneyi okur: Berkshire 2026 Q2 için 1 yeni · 7 artırdı · 6 azalttı · 1 çıkış (15 değişiklik). Kartta ilk 3 + "+ X, Y, Z".
Canlı sayfada "5 artırdı" görülüyorsa: ücretsiz görünüm her listeden en büyük 5 satırı gösterir (`/api/changes`, `FREE_LINES = 5`); sayaç 7 olmalı. PR3'te doğrulanacak.

## E paketi PR'larına devredilen düzeltmeler
- **PR2 (Bugün) / PR4 (Hisse):** canlı site insider adlarını soyad-önce gösteriyor ("Cohen Ryan"); `personName()` ile "Ad Soyad" sırasına çevrilecek. Aynı kişi + aynı gün + aynı işlem türü satırları birleştirilecek (toplam adet, ağırlıklı ortalama fiyat, "n lot"); sütun başlığı "İşlemden bu yana".
- **PR3 (Fon):** "Bu çeyrek ne yaptı" sayaçlarının ücretsiz görünümde kesilmediği doğrulanacak.
- **PR5:** logo kaynağı Finnhub profil alan adı + şirket sitesinden ≥64px ikon (apple-touch-icon / og:image); favicon kullanılmaz.

## Mockup'ta temsili olanlar
- Takip listesi örneği (Berkshire, Duquesne, Appaloosa) ve kullanıcı adı.
- Hisse sayfasında "NASDAQ" borsa etiketi; "Gün aralığı / Hacim" satırları veri kaynağında olmadığı için gizlenecek.
