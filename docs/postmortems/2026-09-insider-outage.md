# Olay raporu: Insider (Form 4) akışı 9 gün durdu — Eylül 2026

| | |
|---|---|
| **Etkilenen dönem** | 21–25 Eylül 2026 dosyalamaları (5 iş günü) hiç alınmadı; fark edilme 27 Eylül |
| **Etkilenen yerler** | /insiders, /insiders/cluster, /csuite, /penny, ana sayfa "Insider Duyarlılığı" (insider e-posta uyarıları o sırada hiç gönderilmiyordu) |
| **Etkilenmeyen** | Hisse sayfası (`/api/insiders/:ticker`), çünkü o sırada doğrudan SEC'e soruyordu |
| **Kök neden** | Tarama planı, SEC'in henüz yayınlamadığı "bugünün" günlük index'ini tatil sanıp atlıyor ve kaldığı yeri (checkpoint) onun ötesine taşıyordu |
| **Tespit** | Elle; site 18 Eylül'de takılıydı, rakip 25 Eylül'ü gösteriyordu |

## Ne oldu

Form 4 verisi her sabah bir GitHub Actions işi (`insiders.yml`) ile SEC EDGAR'ın günlük index dosyalarından çekiliyor. 13 Eylül'de, resmî tatillerin taramayı kilitlemesini önlemek için bir kural eklendi (`e7b0387e`, `f5a89c94`): "SEC'in çeyrek listesinde olmayan gün yayınlanmamıştır, atla."

SEC bir günün index'ini o günün **akşamı** yayınlar. İş sabah çalıştığında bugünün index'i listede henüz yoktur. Kural bugünü "tatil" sayıyor ve taranacak başka gün kalmadığında checkpoint'i bugünün üzerine taşıyordu. Ertesi sabah o gün geçmişte kaldığı için bir daha hiç okunmadı.

Kural 13 Eylül'den beri koddaydı ama iş o güne kadar birikmiş günleri kapatıyordu. Taranacak başka gün olduğu sürece checkpoint doğru ilerledi. 21 Eylül Pazartesi, işin tam güncel olduğu ilk sabahtı ve hata o gün başladı:

```
2026-09-22T09:34:40 Existing dataset: 83916 rows, last day 2026-09-21
2026-09-22T09:34:40   EDGAR published no index for 1 day(s): 2026-09-22
2026-09-22T09:34:40 Enriching: 4578 tickers…            ← tek gün taranmadan
2026-09-22T09:36:09 insiders.json: 83733 rows … through 2026-09-22
```

Kuralın eski testi bu davranışı "doğru" diye sabitlemişti: `crawl plan: a run of holidays still advances the checkpoint — moves past every unpublished day`.

## Neden 9 gün fark edilmedi

1. **İş yeşil bitti.** "0 gün tarandı" hata sayılmıyordu.
2. **Kaydedilen tarih yalan söyledi.** `lastDay` alanı checkpoint'ti (25 Eylül); veride ise 18 Eylül'den sonra satır yoktu. İşin içindeki tazelik adımı `lastDay`'e baktığı için "0 gün eski" dedi.
3. **Sitedeki etiketler veriye bağlı değildi.** "Güncelleme 2026-09-27" dosyanın yazılma zamanıydı. "Canlı veri" rozeti koda sabitti.
4. **Doğru alarm duyulmadı.** Ayrı tazelik kontrolü (`freshness.yml`), teaser dosyasının gerçek tarihine baktığı için 24 Eylül'den beri kırmızıydı (`insider teaser (public) STALE data through 2026-09-18 (9d)`). Ama kırmızı bir Actions satırından öteye gitmedi; e-posta veya webhook bağlı değildi.

## Beş neden

1. Site neden 18 Eylül'de takılı? → 21 Eylül'den beri tek Form 4 okunmadı.
2. Neden okunmadı? → Her gün, okunmadan "işlendi" sayıldı.
3. Neden işlendi sayıldı? → Checkpoint, "tatil" sayılan günün üzerine taşındı.
4. Neden tatil sayıldı? → "Listede yok = tatil" varsayımı. Oysa sabah çalışmasında bugün **her zaman** listede yoktur.
5. **Neden bu canlıya çıktı?** → Testler yalnızca geçmiş tarihleri denedi, "bugün henüz yayınlanmadı" durumunu denemedi. İlerleme olmamasını hata sayan bir kural da yoktu.

## Etki

- **Eksik aralık:** 21, 22, 23, 24, 25 Eylül dosyalamaları (5 iş günü).
- **Eksik hacim (tahmin):** Olaydan önceki 9 iş gününde ortalama ~950 saklanan işlem/gün ve ~90 açık piyasa alımı/gün vardı. Buna göre ~4.800 işlem ve ~450 açık piyasa alımı eksik; kabaca ~7.500 Form 4. Kesin sayılar, backfill'in `dry_run` çıktısında gün gün yazılır.
- **Örnek:** Berkshire Hathaway'in ~25 Eylül'deki LEN alımı sitede yoktu.
- **Kalıcılık:** Günler kendiliğinden geri gelmeyecekti. Checkpoint onları geçmişti; üç aylık SEC toplu veri seti de yalnızca boş bir veri setini doldurmak için okunuyordu.

## Yapılan düzeltme

**Kök neden** (`api/_lib/insiderCrawl.js`). Bir gün okunmadan yalnızca şu üç durumda geçilir:

- (a) hafta sonudur;
- (b) SEC'in kapalı olduğu federal tatildir (`client/src/lib/secCalendar.js`, 2026–2027 statik liste; Columbus Day ve Veterans Day dahil);
- (c) SEC ondan **sonraki** bir iş gününü yayınlamış ama onu yayınlamamıştır.

Bunlardan hiçbiri değilse gün **bekler**. Checkpoint yalnızca gerçekten okunmuş ya da bu kurallarla atlanmış son günü gösterir.

**Artık hata sayılan durumlar** (iş kırmızı biter, veri yine commit'lenir):

- okunamayan gün (403/429/5xx, 2–4–8–16 sn aralıkla 4 denemeden sonra);
- SEC'in reddettiği tek bir filing;
- Form 4 sayısı eşiğin (`INSIDER_MIN_FORM4`, varsayılan 200) altında kalan iş günü;
- "taranacak gün vardı ama hiçbiri okunmadı";
- bir iş gününden uzun süredir yayınlanmamış gün.

**Veri bütünlüğü:**

- Her satırın anahtarı (accession, satır sırası). Yazım filing düzeyinde upsert; aynı günü iki kez okumak hiçbir şeyi değiştirmez.
- Bozuk XML `api/_data/insider-ingest-errors.json`'a yazılır, günün geri kalanı işlenir.
- Her çalışma son 3 iş gününü yeniden okur (geç gelen filing'ler ve 4/A'lar için).
- 4/A orijinali silinmez, `sb` (superseded by) ile işaretlenir. Hiçbir sayfa, sayı veya sinyal onu kullanmaz.

**Tek hat:**

- Bütün okuma ve yazma `api/_lib/insiderStore.js` üzerinden geçer. Supabase'e taşıma = bu dosyayı yeniden yazmak.
- Hisse sayfası da artık aynı veri setini okur; canlı SEC isteği yalnızca yedektir.

**Görünürlük:**

- Bütün tazelik kontrolleri verinin içindeki tarihe bakar (`api/_lib/freshnessChecks.js`): insider için en yeni filing, consensus için çeyrek, fiyatlar için son kapanış, 13F için en yeni 13F filing.
- "Canlı veri" rozeti ve "Güncelleme" etiketi aynı kurala bağlı: veri 1 iş gününden eskiyse "Son veri: <tarih>" yazar.
- Insider işi, tazelik kontrolü ve consensus build'i başarısız olunca `data-alarm` etiketli bir GitHub issue açılır; issue gövdesi ve her yorum `ALERT_MENTION` hesabını (varsayılan @mustafakocer) etiketler, GitHub e-postası bu etiketle gelir. Aynı alarm tekrar ederse açık issue'ya yorum eklenir; iş yeniden yeşil olunca issue "çözüldü" yorumuyla kapanır. Issue açılamazsa iş kırmızı biter. Resend e-postası isteğe bağlı ikinci kanal olarak durur.
- Sağlayıcı reddi (FMP 402 gibi) "bilinen sorun"dur: ilk seferde tek bir issue açılır. Aynı durum sürdükçe iş yeşil kalır ve yeni bildirim gitmez. Sağlayıcı düzelince ya da başka bir sağlayıcı reddetmeye başlayınca yeniden bildirim gelir. Sürekli çalan alarm görmezden gelinir; bu olayın dersi de buydu.
- Tatil listesi 2027'de biter. Listede olmayan bir yıla girilince tarama kırmızı biter; 2027-10-01'den itibaren her çalışma "2028 listesi eklenmeli" uyarısı verir.
- Ana sayfa ile /insiders özet sayıları tek fonksiyondan gelir (`daySummary`). Önceden aynı gün için 62 / $21.6M ile 63 / $31.3M diyebiliyorlardı; fark, bir tarafın ticker'sız satırları sayıp diğerinin saymamasıydı.

**Takvim:** Günde 2 çalışma (03:31 ve 11:02 UTC). Mantık saate güvenmez; her çalışma checkpoint'ten sonra eksik ne varsa okur.

## Tekrarı önleyen testler

- `tests/insider-crawl.test.mjs`:
  - 21 Eylül senaryosu (eski kodda başarısız, yeni kodda başarılı);
  - bir haftalık sabah çalışmalarında hiç gün kaybolmaması;
  - Cuma → Pazartesi geçişi;
  - 12 Ekim federal tatili;
  - geç yayınlanan index;
  - kural (c);
  - 403/429 ve tekrar denemeler;
  - bozuk XML;
  - Form 4 hacim eşiği.
- `tests/insider-store.test.mjs`:
  - idempotent yazım;
  - Colis vakası (aynı filing'de iki ayrı satır);
  - 4/A kuralı;
  - ana sayfa ile /insiders sayılarının eşitliği;
  - veri tarihine göre tazelik ve rozet kuralı.

## Açık kalanlar

- 4/A eşleştirmesi (sahip + ihraççı + işlem tarihi + kod + adet), adedi düzelten bir amendment'ı tanımaz. Bilinen sınır.
- Sahip CIK'si ve form tipi olmayan eski satırlar için `--reingest-same-trade` modu var: aynı işlemin iki accession'da göründüğü 678 grubu yeniden okur ve kuralla kaçının çözüldüğünü yazar.
- 12 Ekim 2026 (Columbus Day), bu düzeltmeden sonraki ilk canlı tatil sınavı.
