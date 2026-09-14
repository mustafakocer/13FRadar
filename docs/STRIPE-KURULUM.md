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
- Endpoint oluşunca görünen **Signing secret** (`whsec_…`) değerini kopyala.

## 3. Customer portal (Settings → Billing → Customer portal)

"Aboneliği yönet" butonu Stripe'ın hazır portalını açar. Portalı bir kez etkinleştir; iptal, kart değiştirme ve fatura indirme seçeneklerini orada aç.

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

`supabase/schema.sql` dosyasının sonundaki iki satırı SQL Editor'da çalıştır (mevcut tabloya güvenle eklenir):

```sql
alter table public.profiles add column if not exists stripe_customer_id text;
alter table public.profiles add column if not exists stripe_subscription_id text;
```

## 6. Test

1. Stripe'ı test moduna al, test anahtarlarıyla değişkenleri gir.
2. Siteye giriş yap → Fiyatlandırma → **Abone Ol**. Stripe Checkout açılmalı. Test kartı: `4242 4242 4242 4242`.
3. Ödeme sonrası `/account?checkout=success` sayfası açılır ve birkaç saniye içinde plan **PRO** olur.
4. Stripe → Webhooks → endpoint → son teslimatta `200 {"ok":true,"event":"checkout.session.completed","plan":"pro"}` görünmeli.
5. Hesap sayfasındaki **Aboneliği yönet** ile portal açılmalı; iptal edince dönem sonuna kadar Pro kalır, `customer.subscription.deleted` gelince Free'ye düşer.

## Akış özeti

```
Fiyatlandırma → POST /api/checkout?cycle=m|y (kullanıcı token'ı)
             → sunucu fiyatı (TR/global) seçer, Stripe Checkout Session açar
             → Stripe ödeme alır
             → webhook: checkout.session.completed → profiles.plan = 'pro'
             → yenileme/iptal: customer.subscription.updated|deleted → plan güncellenir
```

Webhook her teslimatta `Stripe-Signature` başlığını ham gövde üzerinden HMAC-SHA256 ile doğrular ve 5 dakikadan eski imzaları reddeder. Kullanıcı eşlemesi `client_reference_id` / abonelik metadata'sındaki `user_id` ile, yedek olarak `stripe_customer_id` ile yapılır.
