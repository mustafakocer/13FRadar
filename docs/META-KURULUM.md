# Ölçüm kurulumu: Meta Pixel + Conversions API, Google Analytics 4, Microsoft Clarity

Kod hazır; ortam değişkenleri girilene kadar **tamamen kapalıdır** (banner da çıkmaz).

## 1. Pixel (dataset) oluştur
Meta Business → Events Manager → **Connect data sources → Web** → isim ver → Pixel ID'yi kopyala (15–16 haneli sayı).

## 2. Conversions API token
Events Manager → pixel → **Settings → Conversions API → Generate access token**.

## 3. Domain doğrulama
Business Settings → Brand safety → **Domains** → `fundocap.co` ekle (DNS TXT kaydı). Ardından
Events Manager → **Aggregated Event Measurement**'te olay önceliği: Purchase > InitiateCheckout > CompleteRegistration.

## 4. Vercel ortam değişkenleri (Production)
| Değişken | Değer |
|---|---|
| `VITE_META_PIXEL_ID` | Pixel ID (istemci bundle'ı; build sırasında gömülür) |
| `META_PIXEL_ID` | aynı Pixel ID (sunucu) |
| `META_CAPI_TOKEN` | 2. adımdaki token |
| `META_TEST_EVENT_CODE` | *(isteğe bağlı)* Events Manager → Test events kodu; test bitince **sil** |

Değişkenleri girdikten sonra bir deploy gerekir (`VITE_` değeri build'e gömülür).

## 5. Test
1. `META_TEST_EVENT_CODE` ile deploy et, siteyi aç, banner'da **Kabul et**.
2. Events Manager → Test events: `PageView` (tarayıcı), kayıt sonrası `CompleteRegistration`,
   Pro'ya tıklayınca `InitiateCheckout`, test kartıyla ödemede `Purchase` — her biri **Browser + Server**
   olarak görünmeli ve "Deduplicated" yazmalı.
3. Test kodunu kaldırıp tekrar deploy et.

## Olaylar
| Olay | Tarayıcı (fbq) | Sunucu (CAPI) | event_id |
|---|---|---|---|
| PageView | her sayfa geçişi | — | — |
| CompleteRegistration | yeni hesabın ilk girişi | `/api/meta-event` (hesap < 24 saat) | `reg_<user id>` |
| InitiateCheckout | Pricing → Stripe'a gidiş | `/api/checkout` | `ic_<rastgele>` |
| Purchase | `/checkout/success` | Stripe webhook `checkout.session.completed` | `purchase_<session id>` |

Hepsi yalnız banner'da **Kabul et** diyen ziyaretçi için çalışır. Satın alma onayı Stripe oturumunun
metadata'sında (`meta_consent=1`) taşınır; webhook o işaret yoksa Meta'ya hiçbir şey göndermez.
E-posta ve kullanıcı id'si sunucuda SHA-256 ile karma alınır; tarayıcıya kişisel veri verilmez.
Kod: `api/_lib/metaCapi.js`, `client/src/lib/metaPixel.js`, `client/src/lib/consent.js`,
`client/src/components/ConsentBanner.jsx`.

## Google Analytics 4
1. analytics.google.com → Admin → **Create property** → Web stream → `https://www.fundocap.co`.
2. Measurement ID'yi (`G-XXXXXXXXXX`) Vercel'e **`VITE_GA_MEASUREMENT_ID`** olarak gir, deploy et.
3. Web stream → Enhanced measurement → **"Page changes based on browser history events" kapalı** olsun
   (sayfa görüntülemeyi kod gönderiyor; açık kalırsa her sayfa iki kez sayılır).
4. Admin → Events → `purchase`, `sign_up`, `begin_checkout` olaylarını **Key event** işaretle.
5. Google Ads açacaksan: Admin → Product links → Google Ads bağla, `purchase`'ı dönüşüm olarak içe aktar.

Olaylar: `page_view`, `sign_up`, `begin_checkout`, `purchase` (transaction_id = Stripe oturumu, değer ve para birimiyle),
`add_to_wishlist`, `file_download`, `pro_click`, `digest_on/off`. Kullanıcı id'si veya e-posta gönderilmez.
Reklam çerezleri (Consent Mode `ad_storage`) kapalı kalır; GA yalnız ölçüm yapar.

## Microsoft Clarity
1. clarity.microsoft.com → **New project** → site URL → Project ID'yi (10 karakter civarı) kopyala.
2. Vercel'e **`VITE_CLARITY_ID`** olarak gir, deploy et.
3. Settings → Masking: **Balanced** (varsayılan) veya **Strict** bırak — form alanları kayıtta görünmez.
4. İstersen Settings → Setup → **Google Analytics integration** ile GA4'e bağla.

Üçü de aynı banner'a bağlı: **Kabul et** olmadan hiçbiri yüklenmez; Reddet/geri çekmede çerezleri silinir.
