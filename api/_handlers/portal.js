import { getUser, getProfile, noStore } from '../_lib/auth.js';
import { hasStripe, stripePost, stripeGet } from '../_lib/stripe.js';

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
    let customer = null;
    try {
      customer = (await getProfile(user.id, 'stripe_customer_id'))?.stripe_customer_id || null;
    } catch {
      /* column may not exist yet */
    }
    if (!customer) {
      // fallback: the customer created by Checkout carries our user id
      const found = await stripeGet('/v1/customers/search', {
        query: `metadata['user_id']:'${user.id}'`,
        limit: 1,
      });
      customer = found?.data?.[0]?.id || null;
    }
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
