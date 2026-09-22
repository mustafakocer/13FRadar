import { getUser, getProfile, noStore } from '../_lib/auth.js';
import { hasStripe, stripePost } from '../_lib/stripe.js';

// POST /api/portal  (bearer token required)
// Opens the Stripe customer portal (change card, cancel, invoices).
export default async function handler(req, res) {
  noStore(res);
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!hasStripe()) return res.status(503).json({ error: 'not-configured' });

  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'sign-in-required' });

  const proto = req.headers['x-forwarded-proto'] || 'https';
  const origin = process.env.SITE_URL || `${proto}://${req.headers.host}`;

  try {
    // The portal is for Stripe customers. The profile row is the record
    // (S3 makes the column unique; the webhook fills it): an account without
    // a customer id — a manual or open-ended Pro grant, a free account — has
    // nothing there, and used to reach Stripe's customer search anyway.
    const customer = (await getProfile(user.id, 'stripe_customer_id'))?.stripe_customer_id || null;
    if (!customer) return res.status(404).json({ error: 'no-subscription' });

    const session = await stripePost('/v1/billing_portal/sessions', {
      customer,
      return_url: `${origin}/account`,
    });
    res.status(200).json({ url: session.url });
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
}
