# 2026 veri kapsamı denetimi (2026-10-28)

Soru: SEC EDGAR'a ve Kongre'ye 2026 boyunca düşen veriler (13F çeyreklik
portföyler, Form 4 insider işlemleri, Kongre STOCK Act bildirimleri)
FundoCap'te eksiksiz mi? Ölçüm `main`'deki veri dosyaları üzerinde,
`scripts/audit-data.mjs` ve `scripts/check-freshness.mjs` ile yapıldı; site
yapısı ve dosya biçimleri değiştirilmedi.

## Özet

| Veri seti | 2026 kapsamı | Boşluk | Yapılan |
|---|---|---|---|
| 13F evreni (`universe.json`, `latest-holdings.json`) | 8.953 dosyalayıcı, hepsinin en yeni kitabı: 6.265'i 2026 Q2, 2.683'ü 2026 Q3 (28 Ekim itibarıyla) | yok | — |
| Guru geçmişi (`guru-history.json`, 86 fon) | 2025 Q4, 2026 Q1, 2026 Q2 tam; 2026 Q3 dosyalayanlarda var | yok (bkz. "beklenen eksikler") | — |
| 13F bildirim akışı (`filings.json`) | son 120 gün (tasarım: `FILINGS_WINDOW`) | tasarım gereği pencere | — |
| Insider / Form 4 (`insiders.json`) | 1 Ocak–27 Ekim her iş günü **hariç 1 Nisan–11 Mayıs** | 28 iş günü, sıfır satır | backfill (aşağıda) |
| Kongre — Temsilciler Meclisi | 2026: 389 PTR okundu, 58 taranmış (kâğıt) kayıt, 0 hata | yok | — |
| Kongre — Senato | 21 Ekim'e kadar 128 PTR okundu, 9 kâğıt | 23 Ekim'den beri eFD sitesi otomatik erişimi engelliyor (Akamai, HTTP 403) | engel kayda alındı, sayfada not, freshness satırı |

`audit-data.mjs`: 20 veri setinin hepsi **ok** (2026-10-28). `check-freshness.mjs`:
13F evreni, insider, Kongre (Meclis ve Senato satırları), fiyatlar, konsensüs
hepsi süresi içinde.

## 13F: çeyreklik portföy dağılımları

- Evren 2026Q3 + 2026Q4 EDGAR çeyrek indekslerinden kurulur; her dosyalayıcı
  için en yeni etkin 13F (düzeltmeler uygulanmış) ve 2026 Q2 referans dosyası
  tutulur. Manşet çeyrek 14 Kasım'a (30 Eylül + 45 gün) kadar 2026-06-30'dur;
  Q3 kitapları geldikçe satırlara işleniyor (28 Ekim: 2.683 dosyalayıcı).
- Herhangi bir dosyalayıcının herhangi bir 2026 çeyreği `/api/holdings/{cik}/{acc}`
  ile EDGAR'dan canlı okunur (etkin snapshot, `api/_lib/sec.js`). Tüm
  evren × tüm çeyrekleri depoya yazmak (≈36 bin dosya, GB'lar) mevcut
  mimarinin dışındadır ve istenmedi; guru seti için 40 çeyrek saklanır.
- **Beklenen eksikler** (veri hatası değil): Scion (0001649339) 2025 Q3'ten
  sonra kayıttan çıktı; Greenlight Capital Inc (0001079114, 2023'e kadar) ve
  Pershing Square Capital Management (0001336528, 2026 Q1'e kadar) halef
  CIK'lere devretti; halefler (0001489933, 0002026053) 2026'yı taşıyor.
- `fund-flags.json`: 38 dosyalayıcıda kapak toplamı ile tablo toplamı
  uyuşmazlığı (birim hatası) işaretli ve düzeltilmiş (`unit-corrections.json`).
- Evren "şu anda dosyalayan fonlar"dır: son 13F'ini 2026 başında verip
  bırakan bir fon iki çeyrek sonra evrenden düşer (5 "stale" satır).

## Insider / Form 4

- Saklama kuralları (`build-insiders.mjs`): 12 ay pencere; satışlar 120 gün,
  gürültü (hibe, vergi stopajı, hediye) 90 gün tutulur. Ocak–Mart 2026'da
  yalnız alımların (P) kalması bundandır; iş günü başına medyan alım sayısı
  Ocak 47, Şubat 70, Mart 100, Mayıs 125, Haziran 76 — kopukluk yok.
- **1 Nisan–11 Mayıs 2026: 28 iş günü hiç okunmamış.** Diğer sıfır günlerin
  hepsi SEC tatili (1 Ocak, 19 Ocak, 16 Şubat, 25 Mayıs, 19 Haziran, 3 Temmuz,
  7 Eylül, 12 Ekim). Backfill sonucu aşağıda.
- `insider-ingest-errors.json`: 0 hata. SEC'in resmî Insider Transactions
  veri setiyle çapraz kontrol haftalık (`sec-dataset.yml`, etiket
  `kaynak-karsilastirma`).

## Kongre

- Meclis: Clerk'in yıllık indeksi (2025FD/2026FD) her çalışmada okunur;
  2026'da 447 PTR indekslendi, 389 okundu, 58 kâğıt (taranmış, metin yok).
- Senato: 23 Ekim 06:04 UTC'den beri efdsearch.senate.gov'un önündeki Akamai
  bot koruması onay formu POST'una 403 döndürüyor; GET'ler geçiyor. Kod
  tarafında değişiklik yok, son başarılı okuma 23 Ekim 00:56. Aşmak bot
  kontrolünü atlatmak olur; yapılmadı. Engel `freshness/congress.json`
  `senate_block` alanına yazılıyor, Kongre sayfası not gösteriyor, freshness
  "congress trades (Senate)" satırı 15 iş günü sonra alarm verir.
  Alternatif kaynak (FMP / Quiver, ücretli) kararı açık.

## Insider backfill sonucu (1 Nisan–11 Mayıs 2026)

Tek seferlik, push ile tetiklenen bir kopya workflow (run 40786274956,
2026-10-28 23:17 → 2026-10-29 00:53 UTC) `build-insiders.mjs --from
2026-04-01 --to 2026-05-11` komutunu çalıştırdı; önce kuru sayım, sonra okuma,
`audit-data.mjs --only=insiders,insiders-teaser` ve commit (832c6bc9).

| | |
|---|---|
| Okunan iş günü | 29 / 29 |
| EDGAR günlük indekslerindeki Form 4 | 39.914 (gün başına 598–4.410; eşik 200) |
| Çıkarılan işlem satırı | 10.218 |
| Saklama kurallarından sonra sunulan satır | 5.255 (1.777 alım, 3.057 opsiyon kullanımı, 362 dönüşüm, 59 diğer); satışlar ve gürültü 120/90 gün kuralıyla düşer |
| Dokunulan hisse | 1.055 |
| Okunamayan belge | 8 / 39.914: EDGAR'ın indekste listeleyip 404 döndürdüğü (kaldırılmış) dosyalar — `0000899140-26-000403` (3 CIK altında, 30 Nisan), `0001297515-26-000002` (2 CIK, 5 Mayıs) ve 3 benzeri |
| `insiders.json` | 79.693 → 84.948 satır; 2026'da sıfır satırlı iş günü kalmadı (tatiller hariç) |
| Denetim | `audit-data.mjs` 20/20 ok; `ingest-errors` 0 |

Çalışma GitHub'da "failure" görünür: 8 kaldırılmış belgeyi "sorun" sayıp
çıkış kodu 1 verdi, ama veri önce yazılıp denetimden geçirildi ve
commit'lendi (işin tasarımı: önce yaz, sonra alarm). `freshness/insiders.json`
`last_error` alanı bir sonraki gece çalışmasında (03:31 UTC) temizlenir.
