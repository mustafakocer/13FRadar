import { getUser, getProfile, noStore } from '../_lib/auth.js';
import { hasStripe, priceFor, stripePost } from '../_lib/stripe.js';

// POST /api/checkout?cycle=m|y  (bearer token required)
// Creates a Stripe Checkout session for the signed-in user and returns its
// URL. The regional price is decided here from Vercel's IP country header.
export default async function handler(req, res) {
  noStore(res);
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!hasStripe()) return res.status(503).json({ error: 'not-configured' });

  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'sign-in-required' });
  if (user.plan === 'pro') return res.status(409).json({ error: 'already-pro' });

  const cycle = req.query.cycle === 'y' ? 'y' : 'm';
  const country = String(req.headers['x-vercel-ip-country'] || '').toUpperCase();
  const price = priceFor(cycle, country);
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
      subscription_data: { metadata: { user_id: user.id, country } },
      metadata: { user_id: user.id },
      allow_promotion_codes: true,
      success_url: `${origin}/account?checkout=success`,
      cancel_url: `${origin}/pricing?checkout=cancel`,
    });
    res.status(200).json({ url: session.url });
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
}
