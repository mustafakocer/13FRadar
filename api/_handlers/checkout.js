import { getUser, getProfile, noStore } from '../_lib/auth.js';
import { hasStripe, stripePost } from '../_lib/stripe.js';
import { planCatalog } from '../_lib/plans.js';

// POST /api/checkout?cycle=m|y  (bearer token required)
// Creates a Stripe Checkout session for the signed-in user and returns its
// URL. The price — region and currency — is the one /api/plans showed this
// visitor (api/_lib/plans.js, from Vercel's IP country header), so the
// amount on the page is the amount charged. Stripe sends the customer back
// to /checkout/success or /checkout/cancel.
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
    const session = await stripePost('/v1/checkout/sessions', {
      mode: 'subscription',
      line_items: [{ price, quantity: 1 }],
      client_reference_id: user.id,
      ...(customer ? { customer } : { customer_email: user.email }),
      subscription_data: { metadata: { user_id: user.id, country, currency: catalog.currency } },
      metadata: { user_id: user.id },
      allow_promotion_codes: true,
      success_url: `${origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/checkout/cancel`,
    });
    res.status(200).json({ url: session.url });
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
}
