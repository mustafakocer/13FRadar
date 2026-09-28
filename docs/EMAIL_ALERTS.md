# E-posta uyarıları — kaldırıldı (2026-09), nasıl geri açılır

**Durum:** Kullanıcılara giden e-posta uyarıları (13F ve insider özeti) ürün son haline gelene kadar kapalı.

**Neden:** Özet bugüne kadar hiç gönderilmedi. `alerts.yml` her gün `SUPABASE_SERVICE_ROLE_KEY not configured — skipping the digest.` yazıp yeşil bitti.

**Neden şimdi:** Service role anahtarı eklendi ama Resend anahtarı yok. Bu durumda bir sonraki çalışma uyarıları "gönderildi" diye işaretlemeyecekti; ancak her alıcının e-posta adresini ve özetini Actions log'una yazacaktı (eski `scripts/send-alerts.mjs`, `if (DRY || !MAIL_KEY) console.log(\`--- ${to} …\`)` satırı).

**Veriye dokunulmadı:** Supabase'deki `alerts` ve `notification_prefs` tabloları ve içindeki kullanıcı kayıtları yerinde duruyor. Silme ya da migration yapılmadı.

## Neler kaldırıldı

| Parça | Nerede | Kaldıran commit | Özelliği ekleyen commit |
|---|---|---|---|
| "🔔 Alert olarak kaydet" butonu (filtreyi uyarı olarak kaydeder) | `client/src/pages/Insiders.jsx` | `427a94f4` | `7597c0b5`, `b0048936` |
| Hesabım → "Bildirimler / E-posta özeti" (opt-in kutusu, sıklık, kayıtlı uyarı listesi, "tek tıkla bildirim aç") | `client/src/pages/Account.jsx` | `427a94f4` | `b0048936`, `9fc2058a` |
| İzleme listesinde fon başına "bildirim aç / bildirim açık" | `client/src/pages/Watchlist.jsx` | `427a94f4` | `9fc2058a` |
| `useAlerts` hook'u (Supabase'e doğrudan okuma/yazma, RLS altında) | `client/src/hooks/useAlerts.js` (silindi) | `427a94f4` | `b0048936` |
| `alerts.*`, `watchlist.alertEnable/alertOn` metinleri; e-posta vaat eden kopya (landing f6, watchlist v2/v3, paywall satırları, karşılaştırma matrisi) | `client/src/i18n.jsx`, `client/src/content/compare.js` | `427a94f4` | — |
| Gizlilik Bildirimi: Resend işleyen listesinden çıktı; kullanım verisi ve saklama cümleleri | `client/src/content/legal.js` | `427a94f4` | — |
| Zamanlanmış özet | `.github/workflows/alerts.yml` (`schedule` kaldırıldı, elle çalıştırma kaldı) | `427a94f4` | `7597c0b5` |
| Özet script'i ilk satırda duruyor | `scripts/send-alerts.mjs` (`EMAIL_ALERTS_ENABLED = false`) | `427a94f4` | `7597c0b5` |

Eşleştirme ve özet mantığı (`api/_lib/alerts.js`) ve testleri (`tests/alerts.test.mjs`) olduğu gibi duruyor.

## Geri açma adımları

1. **Secret'ları ekle** (GitHub → Settings → Secrets and variables → Actions):

   | Secret | Ne için |
   |---|---|
   | `SUPABASE_SERVICE_ROLE_KEY` | Uyarıları RLS'siz okumak ve işaretlemek için (2026-09-28'de eklendi) |
   | `SUPABASE_URL` | Proje adresi |
   | `RESEND_API_KEY` | E-posta gönderimi |
   | `ALERT_FROM` | Gönderen adres; alan adı Resend'de doğrulanmış olmalı, ör. `Fundocap <alerts@fundocap.co>` |
   | `SITE_URL` | İsteğe bağlı; e-postadaki linkler için, varsayılan kanonik site |

2. **Arayüzü geri getir:**
   - `git revert 427a94f4` komutunun yalnızca `client/` altındaki kısmı, ya da `git checkout 427a94f4~1 -- client/src/pages/Insiders.jsx client/src/pages/Account.jsx client/src/pages/Watchlist.jsx client/src/hooks/useAlerts.js`. i18n anahtarlarını da o sürümden al.
   - **Gizlilik Bildirimi'ni hukuki kontrolle geri güncelle:** Resend'i işleyenlere ekle ve e-posta özeti cümlesini "gönderilir" olarak düzelt. `LEGAL_UPDATED` tarihini değiştir.

3. **Birikmiş eski uyarıların toplu gönderilmesini engelle. Script'i açmadan ÖNCE yap:**
   - Kapalı kalınan süre boyunca biriken her şey ilk çalışmada tek e-postada gider. Buna karşı her uyarının kaldığı yeri bugüne çek (Supabase SQL editor):
     ```sql
     -- bugünden önceki hiçbir dosyalama/işlem gönderilmesin
     update public.alerts set last_seen = to_char(now() at time zone 'utc', 'YYYY-MM-DD');
     ```
     `matchFilings` aynı günü yeniden okur (`filed >= last_seen`); yani en fazla o günün dosyalamaları gider.
   - **Önerim:** Kaldırılmadan önce verilmiş `email_digest = true` onaylarını geçersiz say ve kullanıcıdan yeniden onay iste. Vaadin değiştiği bir dönemden kalan onay zayıf bir dayanak:
     ```sql
     update public.notification_prefs set email_digest = false where email_digest;
     ```

4. **Script'i aç:** `scripts/send-alerts.mjs` içinde `EMAIL_ALERTS_ENABLED = true` yap. Aynı commit'te `tests/email-alerts-removed.test.mjs` dosyasını "anahtar yoksa hiçbir şey yazdırma/işaretleme" testine çevir.
   - **Aynı commit'te düzelt:** `RESEND_API_KEY` yokken script alıcı adreslerini log'a yazıyordu. Anahtar yoksa `process.exit(1)` ile çıkmalı.

5. **Tek test e-postası gönder:**
   - Önce kanalı dene (yalnız sana gider):
     ```bash
     curl -sS https://api.resend.com/emails \
       -H "Authorization: Bearer $RESEND_API_KEY" -H 'Content-Type: application/json' \
       -d '{"from":"Fundocap <alerts@fundocap.co>","to":["SENIN_ADRESIN"],"subject":"Fundocap test","text":"test"}'
     ```
   - Sonra yalnız kendi hesabın için bir özet dene:
     - Supabase'de diğer herkesin `email_digest` değeri `false` olsun; yalnız senin hesabın `true`.
     - Actions → Send alert digests → Run workflow, `dry_run` işaretli. Log'da yalnız senin özetin görünmeli.
     - Aynısını `dry_run` işaretsiz çalıştır.

6. **Zamanlamayı geri koy:** `alerts.yml`'e `schedule: - cron: '23 8 * * *'` ekle. Dosya başındaki "kaldırıldı" notunu sil.
