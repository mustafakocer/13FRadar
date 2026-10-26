import { getUser, getProfile, noStore } from '../_lib/auth.js';
import { hasStripe, stripePost } from '../_lib/stripe.js';
import { planCatalog } from '../_lib/plans.js';
import { metaConfigured, sendMetaEvent, browserContext, cleanEventId } from '../_lib/metaCapi.js';

// POST /api/checkout?cycle=m|y  (bearer token required)
// Creates a Stripe Checkout session for the signed-in user and returns its
// URL. The price — region and currency — is the one /api/plans showed this
// visitor (api/_lib/plans.js, from Vercel's IP country header), so the
// amount on the page is the amount charged. Stripe sends the customer back
// to /checkout/success or /checkout/cancel.
//
// Meta (only with ?mc=1, sent when the visitor accepted marketing cookies):
// &eid= the InitiateCheckout event id the browser's fbq() used, &fbp= &fbc=
// the _fbp/_fbc cookies, &url= the page. InitiateCheckout goes to the
// Conversions API here; the browser context rides on the session metadata so
// the webhook can report the Purchase (stripe-webhook.js).
export default async function handler(req, res) {
  noStore(res);
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!hasStripe()) return res.status(503).json({ error: 'not-configured' });

  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'sign-in-required' });
  if (user.pro) return res.status(409).json({ error: 'already-pro' });

  const cycle = req.query.cycle === 'y' ? 'y' : 'm';
  const country = String(req.headers['x-vercel-ip-country'] || '').toUpperCase();
  const catalog = await planCatalog(country);
  const price = catalog.priceIds[cycle];
  if (!price) return res.status(503).json({ error: 'not-configured' });

  const proto = req.headers['x-forwarded-proto'] || 'https';
  const origin = process.env.SITE_URL || `${proto}://${req.headers.host}`;

  try {
    let customer = null;
    try {
      customer = (await getProfile(user.id, 'stripe_customer_id'))?.stripe_customer_id || null;
    } catch {
      /* column may not exist yet */
    }
    const meta = req.query.mc === '1' && metaConfigured() ? browserContext(req, req.query) : null;
    const metaMeta = meta
      ? Object.fromEntries(
          Object.entries({ meta_consent: '1', meta_ip: meta.ip, meta_ua: meta.ua, meta_fbp: meta.fbp, meta_fbc: meta.fbc, meta_url: meta.url })
            .filter(([, v]) => v)
            .map(([k, v]) => [k, String(v).slice(0, 500)]) // Stripe caps metadata values at 500 chars
        )
      : {};
    const initiate = meta && cleanEventId(req.query.eid)
      ? sendMetaEvent({
          name: 'InitiateCheckout',
          id: cleanEventId(req.query.eid),
          email: user.email,
          externalId: user.id,
          country,
          ...meta,
          custom: { currency: catalog.currency, value: Number(catalog[cycle]) || undefined, content_ids: [`pro_${cycle}`], content_type: 'product' },
        })
      : null;
    const session = await stripePost('/v1/checkout/sessions', {
      mode: 'subscription',
      line_items: [{ price, quantity: 1 }],
      client_reference_id: user.id,
      ...(customer ? { customer } : { customer_email: user.email }),
      subscription_data: { metadata: { user_id: user.id, country, currency: catalog.currency } },
      metadata: { user_id: user.id, ...metaMeta },
      allow_promotion_codes: true,
      success_url: `${origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/checkout/cancel`,
    });
    if (initiate) await initiate; // bounded by its own timeout, never throws
    res.status(200).json({ url: session.url });
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
}
