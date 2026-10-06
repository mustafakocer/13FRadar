# E-posta bildirimleri — ikinci sürüm (2026-10-06)

**Durum:** Kod hazır; gönderim, GitHub Actions secret'ları eklenince başlar. Eksik secret varken iş yeşil biter ve hangi anahtarın eksik olduğunu yazar.

## Ne gönderilir

Hesabım sayfasında kutuyu işaretleyen (opt-in, varsayılan kapalı) okuyucuya, **takip listesindeki** fonlar için:

1. Yeni 13F bildirimi (dönem, bildirim tarihi, düzeltme ise işareti, sayfa linki) — `client/public/filings.json`
2. Takip edilen ustanın kendi adıyla verdiği Form 4 işlemleri (gün bazında katlanmış: adet, fiyat, yön) — `api/_lib/guruForm4.js`
3. (Eski sürümden kalan) kayıtlı insider filtreleri — `alerts` tablosu

Sıklık: her gün (yeni bir şey varsa) ya da haftada bir. Dil: hesabın UI dili (`notification_prefs.lang`). Düz metin; alt satırda kapatma linki.

## Parçalar

| Parça | Nerede |
|---|---|
| Eşleştirme, metin, kadans | `api/_lib/alerts.js` (`matchFilings`, `matchForm4`, `matchInsiders`, `renderDigest`, `dueForPrefs`, `maskEmail`) |
| Gönderim işi | `scripts/send-alerts.mjs` — `--dry-run` (adresler maskeli, işaret ilerlemez), `--force` |
| Zamanlama | `.github/workflows/alerts.yml` — her gün 08:23 UTC; iki anahtar da yoksa atlar |
| Okuyucu başına işaret | `notification_prefs.filings_seen / filings_seen_acc / form4_seen / last_sent_at` — `migrations/0006_digest_marks` |
| Arayüz | `client/src/pages/Account.jsx` (kutu + sıklık), `client/src/hooks/useNotificationPrefs.js`, `Watchlist.jsx` ipucu |
| Testler | `tests/email-alerts.test.mjs` (anahtarsız gerçek çalışma = exit 1 ve hiç okuma yok; dry run; gerçek gönderim + işaret), `tests/alerts.test.mjs`, `tests/sql/0006_digest_marks.test.sql` |

## Açmak için yapılacaklar (sırayla)

1. **Migration 0006'yı uygula:** Actions → *DB migrate* → `0006_digest_marks` (ya da README'deki psql döngüsü). Bu adım:
   - işaretleri bugüne çeker → kapalı kalınan sürenin birikimi **gönderilmez** (en fazla o günün bildirimleri gider);
   - eski `email_digest = true` onaylarını sıfırlar → herkes yeniden işaretler (vaadin değiştiği dönemden kalan onay zayıf dayanak).
2. **Resend:** `fundocap.co` alan adını Resend'de doğrula (SPF/DKIM), API anahtarı al.
3. **Secret'lar** (GitHub → Settings → Secrets → Actions): `RESEND_API_KEY`, `ALERT_FROM` (`Fundocap <bildirim@fundocap.co>`), `SITE_URL` (`https://www.fundocap.co`). `SUPABASE_URL` ve `SUPABASE_SERVICE_ROLE_KEY` zaten var.
4. **Kanal testi** (yalnız sana gider):
   ```bash
   curl -sS https://api.resend.com/emails -H "Authorization: Bearer $RESEND_API_KEY" -H 'Content-Type: application/json' \
     -d '{"from":"Fundocap <bildirim@fundocap.co>","to":["SENIN_ADRESIN"],"subject":"Fundocap test","text":"test"}'
   ```
5. **Kendi hesabınla prova:** Hesabım'da kutuyu işaretle, "Her gün"; takip listende en az bir fon olsun. Actions → *Send alert digests* → Run workflow, `dry_run` işaretli → log'da yalnız maskeli adresin ve özet. Sonra `dry_run` işaretsiz, `force` işaretli → e-posta gelir, işaretler ilerler.
6. Zamanlama zaten dosyada; başka bir şey gerekmez.

## Güvenlik notları

- Gerçek çalışma `RESEND_API_KEY`/`ALERT_FROM` yokken **hiçbir şey okumadan** `exit 1` verir; adres log'a düşmez. Dry run adresleri maskeler (`m***@…`).
- İşaretler yalnız gerçek gönderimden sonra ilerler; gönderim hata verirse o okuyucunun işareti yerinde kalır, ertesi gün yeniden denenir.
- Form 4 eşleşmesi yalnız fonun kendi adıyla verdiği satırlar; iştirakler dahil değil (`guruForm4.js`).
