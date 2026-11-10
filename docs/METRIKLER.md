# İş rakamları: kim kayıt oluyor, kim ödüyor, kim okuyor

Üç ayrı yerden üç ayrı soru cevaplanır. Hiçbiri diğerinin yerini tutmaz.

| Soru | Nereden | Durum |
|---|---|---|
| Kaç hesap, kaç Pro, kaç bülten abonesi; bu hafta ne değişti | Haftalık e-posta (bu belge) | `METRICS_TO` secret'ı girilince başlar |
| Gelir, MRR, iade, başarısız tahsilat ayrıntısı | Stripe panosu | hazır |
| Ziyaret, kaynak, hangi sayfa | GA4 (`VITE_GA_MEASUREMENT_ID`, çerez onayıyla) ve Vercel Web Analytics | GA4 açık; Vercel Web Analytics panelde kapalı |

## Haftalık e-posta

`.github/workflows/metrics.yml` her pazartesi 05:13 UTC'de `scripts/send-metrics.mjs`'i çalıştırır.
Supabase'den sayar, `METRICS_TO` adresine düz metin postalar. Main'e commit atmaz, Vercel build'i yoktur.

İçerik (`api/_lib/metrics.js`):

- **Hesaplar:** toplam; son 7 gün, önceki 7 gün, son 30 gün.
- **Pro:** aktif sayı ve hesaplara oranı (`is_pro()` ile aynı tanım); 7 ve 30 günde başlayan ve biten
  abonelik (`stripe_events`, yalnız `applied` olanlar); 7 gün içinde yenilenecek ya da bitecek olanlar;
  başarısız tahsilat. Süresi geçtiği halde planı hâlâ `pro` yazan hesap varsa ayrı bir uyarı satırı çıkar.
- **Bülten ve lead:** onaylı, bekleyen, çıkan; haftalık ve aylık onay; 30 günlük onay oranı; dil, ilk
  geldiği yer, istenen içerik.
- **Kullanım:** takip listesi olan hesap, e-posta özetini açan hesap.

### Neden e-posta, neden issue değil

Bu repo herkese açık: Actions logları, iş özetleri ve issue'lar da öyle. Rakamlar bu yüzden yalnızca
postayla çıkar. Script GitHub Actions içinde hiçbir rakam ya da adres yazdırmaz; sorgular `email`
sütununu hiç istemez, posta yalnız sayı taşır.

### Açmak için

1. GitHub → Settings → Secrets and variables → Actions → **New repository secret**: `METRICS_TO` =
   rakamların gideceği adres (birden fazlaysa virgülle). `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
   `RESEND_API_KEY` ve `LEAD_FROM` (ya da `ALERT_FROM`) zaten var.
2. Actions → *Weekly business figures* → Run workflow, `dry_run` işaretli: tabloların okunduğunu
   doğrular, hiçbir şey göndermez ve yazdırmaz.
3. Aynı işi `dry_run` işaretsiz çalıştır: posta gelir.

Secret girilmeden zamanlanmış çalışma **kırmızı** biter ve eksik anahtarı yazar; sessizce atlamaz.

Postayı göndermeden okumak için kendi makinende:

```bash
SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/send-metrics.mjs --dry-run
```

## Vercel Web Analytics

Kod tarafı hazır (`client/src/main.jsx` `inject()`, `client/src/lib/analytics.js`). Veri gelmesi için
Vercel → proje `13-f-radar` → **Analytics → Enable** gerekir; açıldıktan sonraki ilk production
yayınından itibaren sayar. Çerez kullanmaz, onay banner'ını beklemez; GA4'ün onay vermeyen
ziyaretçide göremediği trafiği de sayar. Pro planda dahil olan olay kotasını aşan kullanım ücretlidir
(Settings → Billing → Spend Management sınırı bunu da kapsar).
