# Lead magnets: bülten, rapor, Excel, portföy karşılaştırma, fon uyarısı

Hesap açmadan e-posta bırakılan beş şey. Hepsi aynı omurgayı kullanır: `subscribers` tablosu,
çift onay (double opt-in), her e-postada tek tıkla çıkış.

| Magnet | Nerede | Ne alır |
|---|---|---|
| `newsletter` | Ana sayfa, Insider, Kongre, Konsensüs | Her pazartesi Akıllı Para Bülteni |
| `report:<id>` | `/reports/<id>` | Çeyrek raporu PDF (TR/EN) |
| `xl-consensus` | Konsensüs | Ustaların en çok sahip olduğu 50 hisse (CSV/Excel) |
| `xl-insiders` | Insider | Son 30 günün en büyük 500 insider alımı (CSV/Excel) |
| `match` | `/match` | Portföy–usta eşleşmesinin tam listesi (ilk 3 ücretsiz) |
| `guru:<cik>` | Fon sayfaları (giriş yapmamış ziyaretçi) | Fon yeni 13F verince e-posta |

Akış: form → `POST /api/subscribe` → onay e-postası → `GET /api/subscribe-confirm` → `/thanks` (indirme
linkleri) + aynı linklerle karşılama e-postası. İndirme linkleri imzalı ve 30 gün geçerli; kimseyi
tanımlamaz. Çıkış: `/api/unsubscribe` (GET sayfaya yönlendirir, POST çıkarır; Gmail/Apple tek tık).

Kod: `api/_lib/leads.js`, `api/_handlers/leads.js`, `api/_lib/leadFiles.js`, `api/_lib/portfolioMatch.js`,
`api/_lib/newsletter.js`, `scripts/send-newsletter.mjs`, `client/src/components/LeadForm.jsx`,
`client/src/pages/{Match,LeadThanks,Unsubscribe}.jsx`. Test: `tests/leads.test.mjs`, `tests/sql/0007_subscribers.test.sql`.

## Açılış (sırayla)

1. **Tablo:** GitHub → Actions → *Database migrate* → `0007_subscribers` → Run.
2. **Resend domain:** resend.com → Domains → `fundocap.co` doğrulanmış olmalı (SPF/DKIM). Gönderen: `bulten@fundocap.co`.
3. **Vercel env (Production):**
   - `RESEND_API_KEY` (Sensitive) — onay ve indirme e-postaları API'den gider
   - `LEAD_FROM` = `Fundocap <bulten@fundocap.co>`
   - `VITE_LEADS_ENABLED` = `1` — formları açar (bu yoksa formlar hiç görünmez; `/match` yine çalışır)
   - İsteğe bağlı `LEAD_SECRET` (rastgele 32+ karakter); yoksa servis anahtarından türetilir
4. **GitHub secrets:** `LEAD_FROM` (yoksa `ALERT_FROM` kullanılır); `RESEND_API_KEY`, `SUPABASE_*` zaten var.
5. Deploy. Kendi adresinle bir form doldur → onay → indir → çık; hepsini dene.
6. *Newsletter and guru alerts* workflow'unu `dry_run` + `force` ile bir kez çalıştır, çıktıyı oku.

**Mail gelmezse:** Vercel → Logs'ta `subscribe:` satırlarına bak. `accepted, resend id=…` varsa
mail Resend'e ulaşmıştır; durumunu (delivered / bounced / suppressed) resend.com → Emails'ta o id ile
izle. `not mailed, rate limit (daily-cap)` ise aynı adrese 24 saatte 3 mail sınırı dolmuştur (form
bunu söyler); `resend HTTP 403` domain doğrulanmamış demektir. Hiç satır yoksa istek API'ye ulaşmamıştır.

## Zamanlama

`.github/workflows/newsletter.yml` her gün 04:41 UTC (07:41 TR): pazartesi bülten, her gün fon uyarıları,
30 günü geçmiş onaylanmamış adresleri siler. Main'e commit atmaz, Vercel build'i yoktur.

## Her çeyrek (rapor PDF'i)

```bash
npm run report -- 2026 3                      # api/_data/reports/2026-q3.json
npm run build
node scripts/build-report-pdf.mjs 2026-q3     # api/_data/reports/2026-q3.{tr,en}.pdf
```
PDF'leri rapor JSON'uyla aynı commit'te gönder.

## Hukuk / uyum

- **İYS:** Türkiye'deki alıcılara ticari elektronik ileti için İleti Yönetim Sistemi kaydı gerekir
  (bülten Pro'ya yönlendirdiği için ticari ileti sayılır). Onaylar `subscribers.consent_*` alanlarında
  (zaman, IP, metin) tutulur; İYS'ye aktarım şimdilik elle.
- Bülten onayı indirmeden **ayrı ve işaretsiz** başlar (indirme ≠ abonelik; GDPR "bağlama" yasağı).
- Bülten ve e-postalar veri anlatır, tavsiye vermez: "al/sat", hedef fiyat yok; her e-postada
  "yatırım tavsiyesi değildir".
