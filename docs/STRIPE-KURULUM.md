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
| Pro Aylık (TR, ₺) | ₺ — aşağıdaki formül | monthly | `STRIPE_PRICE_MONTHLY_TRY` |
| Pro Yıllık (TR, ₺) | ₺ — aşağıdaki formül | yearly | `STRIPE_PRICE_YEARLY_TRY` |

Her fiyatın `price_…` kimliğini kopyala. Hangi fiyatın gösterileceğine ve tahsil edileceğine sunucu tek yerde karar verir (`api/_lib/plans.js`, Vercel'in IP ülke başlığı); istemciden değiştirilemez ve sayfadaki tutar ile Checkout'taki tutar aynıdır. Türkiye'den gelen ziyaretçi:

- `STRIPE_PRICE_*_TRY` ikisi de tanımlıysa fiyat **₺** olarak gösterilir ve tahsil edilir (tutarlar Stripe'tan okunur, 6 saat cache).
- Tanımlı değilse `_TR` USD fiyatı gösterilir, yanında günlük kurla "≈ ₺X" ve "tahsilat USD" notu (kur: frankfurter.app → open.er-api.com, 24 saat cache).

₺ fiyatı belirlemek için: `GET /api/plans` (TR IP'den ya da `x-vercel-ip-country: TR` başlığıyla) `suggestedTry` alanını verir = USD × kur × 1,03 (kur payı), yukarı …49/…99'a yuvarlanmış. Stripe'ta bu tutarlarla TRY fiyatları aç, kimlikleri env'e gir, redeploy.

## 2. Webhook (Developers → Webhooks → Add endpoint)

- **Endpoint URL:** `https://<siteniz>/api/stripe-webhook`
- **Events:**
  - `checkout.session.completed`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.payment_failed`
  - `charge.refunded`
  - `charge.dispute.created`
  - `charge.dispute.closed`
- Endpoint oluşunca görünen **Signing secret** (`whsec_…`) değerini kopyala.

Her event ne yapar (`api/_handlers/stripe-webhook.js`):

| Event | `profiles` |
|---|---|
| `checkout.session.completed` | `plan='pro'`, `stripe_customer_id`, `stripe_subscription_id`, `plan_expires = current_period_end` (abonelik Stripe'tan okunur) |
| `customer.subscription.created` / `updated` | `active`/`trialing`: `plan_expires = current_period_end`. `past_due`: `plan_expires = ödenmeyen dönemin başı + 7 gün` (aşağıda 3b). `canceled`/`unpaid`/`incomplete_expired`/`paused` → `plan='free'`; `incomplete` yok sayılır |
| `customer.subscription.deleted` | `plan='free'`, `plan_expires=null`, `stripe_subscription_id=null` (müşteri kimliği portal için kalır) |
| `invoice.payment_failed` | hiçbir şey; loglanır |
| `charge.refunded` | İçinde bulunulan dönemin tahsilatı **tam** iade edildiyse `plan='free'`, `plan_expires=null`. Kısmi iade (`logged:partial-refund`) ve eski bir dönemin iadesi (`logged:refund-earlier-period`) hiçbir şeyi değiştirmez |
| `charge.dispute.created` | İtiraz açılır açılmaz `plan='free'` |
| `charge.dispute.closed` | `lost` → `plan='free'`; `won` → yalnızca loglanır, Pro kendiliğinden geri açılmaz (müşteri ödemeye devam ediyorsa sonraki abonelik olayı açar) |

**İade ederken aboneliği de iptal et.** Webhook Stripe'a hiçbir şey yazmaz:
aboneliği iptal etmez, iade yapmaz. Tam iade Pro'yu hemen kapatır, ama abonelik
Stripe'ta açık kalırsa bir sonraki yenileme (ya da "dönem sonunda iptal":
Stripe bunu hâlâ `active` bir abonelik olarak bildirir) Pro'yu yeniden açar.
İade yaptığında Stripe'ta aboneliği **Cancel immediately** ile kapat.

İade ve itiraz olayları fiyat taşımaz. "Bizim" olduğu şöyle doğrulanır:
tahsilatın müşteri kimliği bir profilde kayıtlı olmalı (oraya yalnızca kendi
ödeme sayfamız yazar; hesaptaki diğer ürünün müşterileri hiçbir profilde yoktur,
olay `skipped:no-user` olarak kapanır) ve o profildeki abonelik aynı müşteriye
ait ve `STRIPE_PRICE_*` fiyatlarından birinde olmalı.

**Sıra.** Stripe olayları oluş sırasıyla teslim etmez. Her profil kendisini
değiştiren son olayın `created` zamanını tutar (`profiles.stripe_event_at`,
migration `0008_stripe_event_order`); daha eski bir olay sonradan gelirse
`ignored:stale` olarak kaydedilir ve plana dokunmaz. Migration uygulanmadan da
webhook çalışır (sıra kontrolü olmadan, eskisi gibi).

**Yalnızca kendi ürünümüzün abonelikleri sayılır.** Stripe hesabında başka
ürünler de satılıyor ve Stripe hesaptaki tüm abonelik olaylarını bu adrese de
gönderiyor. Bu yüzden plan değiştiren her olayda aboneliğin fiyat kimliği
yukarıdaki `STRIPE_PRICE_*` değerleriyle karşılaştırılır; eşleşmeyen olay
`ignored:foreign-price` olarak kaydedilir ve profile dokunmaz (ne Pro verir ne
Free'ye düşürür). Hiç fiyat kimliği tanımlı değilse Pro verilmez
(`ignored:prices-not-configured`).

Bir fiyatı değiştirirseniz (yeni `price_…` oluşturup ortam değişkenini
güncellerseniz) ve eski fiyatta hâlâ abone varsa, eski kimliği
`STRIPE_PRICE_LEGACY` değişkenine ekleyin (virgülle ayrılmış liste). Yoksa o
abonelerin yenilemeleri yabancı ürün sayılır ve Pro süreleri uzamaz.

Her teslimat Stripe event kimliğiyle `public.stripe_events`'e yazılır ve
profil değişikliğiyle **aynı transaction**da (`apply_stripe_event`) işlenir.
Aynı event ikinci kez gelirse `200 {"ok":true,"duplicate":true}` döner, DB
değişmez. Kullanıcı eşlemesi yalnız `client_reference_id` / `metadata.user_id`
(ikisini de `/api/checkout` yazar) ve yedek olarak profildeki
`stripe_customer_id` ile yapılır; e-postayla eşleme yoktur.

## 3a. Customer portal (Settings → Billing → Customer portal)

"Aboneliği yönet" butonu Stripe'ın hazır portalını açar. Portalı bir kez etkinleştir; iptal, kart değiştirme ve fatura indirme seçeneklerini orada aç.

## 3b. Başarısız yenileme: Smart Retries (Settings → Subscriptions and emails)

**Manage failed payments → Smart Retries** açık, yeniden deneme süresi 3 gün;
süre sonunda **cancel the subscription** seçili olsun. Deneme boyunca abonelik
`past_due` kalır; Stripe iptal edince `customer.subscription.updated`
(`canceled`/`unpaid`) ve `…deleted` gelir, plan Free olur.

Kod ayrıca kendi sınırını koyar: yenileme ödenmediğinde Stripe dönemi zaten
ileri almıştır, bu yüzden `past_due` bir abonelikte Pro **ödenmeyen dönemin
başından itibaren 7 gün** sürer (`PAST_DUE_GRACE_DAYS`, `api/_lib/stripe.js`),
dönem sonuna kadar değil. Stripe'ta "aboneliği past_due bırak" seçili olsa bile
ödemeyen hesap 7 gün sonra Pro'dan çıkar; ödeme sonradan alınırsa `active`
olayı tam dönemi geri açar. Yeniden deneme süresini 7 günden uzun yaparsan bu
sabiti de büyüt.

## 4. Vercel ortam değişkenleri (Project → Settings → Environment Variables)

| Değişken | Değer |
|---|---|
| `STRIPE_SECRET_KEY` | `sk_live_…` (test için `sk_test_…`) |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` (2. adım) |
| `STRIPE_PRICE_MONTHLY` | `price_…` |
| `STRIPE_PRICE_YEARLY` | `price_…` |
| `STRIPE_PRICE_MONTHLY_TR` | `price_…` |
| `STRIPE_PRICE_YEARLY_TR` | `price_…` |
| `STRIPE_PRICE_MONTHLY_TRY` | `price_…` (₺; isteğe bağlı, varsa TR'de ₺ gösterilir) |
| `STRIPE_PRICE_YEARLY_TRY` | `price_…` (₺) |
| `SUPABASE_URL` | Supabase → Settings → API → Project URL (sunucu: plan kontrolü `is_pro()`) |
| `SUPABASE_ANON_KEY` | Supabase → Settings → API → anon public (sunucu) |
| `VITE_SUPABASE_URL` | aynı Project URL — istemci paketine build'de gömülür |
| `VITE_SUPABASE_ANON_KEY` | aynı anon key — istemci paketine build'de gömülür |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → service_role (webhook'un plan yazabilmesi için) |
| `SITE_URL` | isteğe bağlı, ör. `https://www.fundocap.co` (ödeme sonrası dönüş adresi: `/checkout/success`, `/checkout/cancel`) |

Gizli anahtarları yalnızca Vercel'e gir; sohbete veya repoya yapıştırma. Değişkenleri kaydettikten sonra **Redeploy** yap. Kodda gömülü URL/anon key yoktur: dört Supabase değişkeni eksikse production build `scripts/check-env.mjs`'te durur; preview'da auth kapalı, Pro kilitli çalışır.

## 5. Supabase şeması

Olay sırası kontrolü için `0008_stripe_event_order` da uygulanmalı (GitHub →
Actions → *Database migrate* → `0008_stripe_event_order` → Run; kendiliğinden
uygulanmaz). `migrations/verify.sql` eksik olanı gösterir.

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
