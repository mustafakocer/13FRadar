# Stripe ile Ödeme Kurulumu

Uygulama abonelikleri Stripe Checkout ile satar, planı Stripe webhook'u ile Supabase'deki `profiles.plan` alanına yazar. Kurulum 15 dakika sürer; hiçbir kod değişikliği gerekmez.

## 1. Ürün ve fiyatlar (Stripe Dashboard → Product catalog)

Tek bir ürün ("Fundocap Pro") altında dört **recurring** fiyat oluştur:

| Fiyat | Tutar | Periyot | Env değişkeni |
|---|---|---|---|
| Pro Aylık | $19.90 | monthly | `STRIPE_PRICE_MONTHLY` |
| Pro Yıllık | $199 | yearly | `STRIPE_PRICE_YEARLY` |
| Pro Aylık (TR) | $10 | monthly | `STRIPE_PRICE_MONTHLY_TR` |
| Pro Yıllık (TR) | $100 | yearly | `STRIPE_PRICE_YEARLY_TR` |

Her fiyatın `price_…` kimliğini kopyala. TR fiyatını hangi ziyaretçinin göreceğine sunucu, Vercel'in IP ülke başlığına bakarak karar verir; istemciden değiştirilemez.

## 2. Webhook (Developers → Webhooks → Add endpoint)

- **Endpoint URL:** `https://<siteniz>/api/stripe-webhook`
- **Events:**
  - `checkout.session.completed`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.payment_failed`
- Endpoint oluşunca görünen **Signing secret** (`whsec_…`) değerini kopyala.

Her event ne yapar (`api/_handlers/stripe-webhook.js`):

| Event | `profiles` |
|---|---|
| `checkout.session.completed` | `plan='pro'`, `stripe_customer_id`, `stripe_subscription_id`, `plan_expires = current_period_end` (abonelik Stripe'tan okunur) |
| `customer.subscription.created` / `updated` | `plan_expires = current_period_end`; status `canceled`/`unpaid`/`incomplete_expired`/`paused` → `plan='free'`; `incomplete` yok sayılır |
| `customer.subscription.deleted` | `plan='free'`, `plan_expires=null`, `stripe_subscription_id=null` (müşteri kimliği portal için kalır) |
| `invoice.payment_failed` | hiçbir şey; loglanır. Tahsilat denemesi ve ödemesiz süre Stripe'ta (aşağıda 3b) |

Her teslimat Stripe event kimliğiyle `public.stripe_events`'e yazılır ve
profil değişikliğiyle **aynı transaction**da (`apply_stripe_event`) işlenir.
Aynı event ikinci kez gelirse `200 {"ok":true,"duplicate":true}` döner, DB
değişmez. Kullanıcı eşlemesi yalnız `client_reference_id` / `metadata.user_id`
(ikisini de `/api/checkout` yazar) ve yedek olarak profildeki
`stripe_customer_id` ile yapılır; e-postayla eşleme yoktur.

## 3a. Customer portal (Settings → Billing → Customer portal)

"Aboneliği yönet" butonu Stripe'ın hazır portalını açar. Portalı bir kez etkinleştir; iptal, kart değiştirme ve fatura indirme seçeneklerini orada aç.

## 3b. Başarısız yenileme: Smart Retries (Settings → Subscriptions and emails)

Ödemesiz süre kodda değil Stripe'ta: **Manage failed payments → Smart Retries**
açık, yeniden deneme süresi 3 gün; süre sonunda **cancel the subscription**
seçili olsun. Deneme boyunca abonelik `past_due` kalır ve kullanıcı dönem
sonuna kadar Pro'dur; Stripe iptal edince `customer.subscription.updated`
(`canceled`/`unpaid`) ve `…deleted` gelir, plan Free olur.

## 4. Vercel ortam değişkenleri (Project → Settings → Environment Variables)

| Değişken | Değer |
|---|---|
| `STRIPE_SECRET_KEY` | `sk_live_…` (test için `sk_test_…`) |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` (2. adım) |
| `STRIPE_PRICE_MONTHLY` | `price_…` |
| `STRIPE_PRICE_YEARLY` | `price_…` |
| `STRIPE_PRICE_MONTHLY_TR` | `price_…` |
| `STRIPE_PRICE_YEARLY_TR` | `price_…` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → service_role (webhook'un plan yazabilmesi için) |
| `SITE_URL` | isteğe bağlı, ör. `https://fundocap.com` (ödeme sonrası dönüş adresi) |

Gizli anahtarları yalnızca Vercel'e gir; sohbete veya repoya yapıştırma. Değişkenleri kaydettikten sonra **Redeploy** yap.

## 5. Supabase şeması

`migrations/` dizinindeki migration'lar uygulanmış olmalı (`0003_stripe_events`
webhook'un kullandığı tabloyu ve `apply_stripe_event` fonksiyonunu kurar):
bkz. `migrations/README.md`.

## 6. Test

1. Stripe'ı test moduna al, test anahtarlarıyla değişkenleri gir.
2. Siteye giriş yap → Fiyatlandırma → **Abone Ol**. Stripe Checkout açılmalı. Test kartı: `4242 4242 4242 4242`.
3. Ödeme sonrası `/account?checkout=success` sayfası açılır ve birkaç saniye içinde plan **PRO** olur.
4. Stripe → Webhooks → endpoint → son teslimatta `200 {"ok":true,"duplicate":false,"event":"checkout.session.completed","result":"applied","plan":"pro"}` görünmeli. Aynı teslimatı **Resend** ile tekrar gönder: `200 {"ok":true,"duplicate":true,…}` ve plan değişmez.
5. Yerelde Stripe CLI ile: `stripe listen --forward-to localhost:3001/api/stripe-webhook` ve `stripe trigger checkout.session.completed` (ardından `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`). Aynı akış ağsız olarak `node --test tests/stripe-webhook.test.mjs` ile koşar ve her teslimattan sonraki `profiles` satırını tablo olarak basar.
6. Hesap sayfasındaki **Aboneliği yönet** ile portal açılmalı; iptal edince dönem sonuna kadar Pro kalır (`plan_expires`), `customer.subscription.deleted` gelince Free'ye düşer.

## Akış özeti

```
Fiyatlandırma → POST /api/checkout?cycle=m|y (kullanıcı token'ı)
             → sunucu fiyatı (TR/global) seçer, Stripe Checkout Session açar
             → Stripe ödeme alır
             → webhook: checkout.session.completed → profiles.plan = 'pro', plan_expires = dönem sonu
             → yenileme/iptal: customer.subscription.updated|deleted → plan_expires / plan güncellenir
             → her event bir kez: stripe_events (event id) + profil değişikliği tek transaction
```

Webhook her teslimatta `Stripe-Signature` başlığını ham gövde üzerinden HMAC-SHA256 ile doğrular ve 5 dakikadan eski imzaları reddeder. Pro tanımı tek yerde, veritabanındaki `is_pro()` fonksiyonundadır: `plan = 'pro'` ve `plan_expires` boş ya da ileride.
