import { authConfigured, setUserPlan, setProfileFields, findUserByCustomer } from '../_lib/auth.js';
import { verifyStripeSignature, readRawBody, planForSubscription, stripePost } from '../_lib/stripe.js';

// Stripe webhook — Stripe dashboard → Developers → Webhooks → Add endpoint:
//   URL:    https://<site>/api/stripe-webhook
//   Events: checkout.session.completed, customer.subscription.created,
//           customer.subscription.updated, customer.subscription.deleted
// Put the endpoint's signing secret (whsec_…) in STRIPE_WEBHOOK_SECRET.
//
// The Supabase user is identified by client_reference_id / metadata.user_id,
// both set by /api/checkout, with a fallback lookup by Stripe customer id.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveUser(obj) {
  const direct = obj?.client_reference_id || obj?.metadata?.user_id;
  if (UUID_RE.test(String(direct || ''))) return String(direct);
  const customer = typeof obj?.customer === 'string' ? obj.customer : obj?.customer?.id;
  if (customer) {
    try {
      return await findUserByCustomer(customer);
    } catch {
      /* fall through */
    }
  }
  return null;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const raw = await readRawBody(req);
  if (raw == null) return res.status(500).json({ error: 'raw-body-unavailable' });

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return res.status(500).json({ error: 'Webhook not configured' });
  if (!verifyStripeSignature(raw, req.headers['stripe-signature'], secret)) {
    return res.status(401).json({ error: 'Bad signature' });
  }
  if (!authConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Auth not configured' });
  }

  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }
  const type = String(event?.type || '');
  const obj = event?.data?.object || {};

  try {
    if (type === 'checkout.session.completed') {
      if (obj.mode !== 'subscription') return res.status(200).json({ ok: true, ignored: type });
      if (!['paid', 'no_payment_required'].includes(obj.payment_status)) {
        return res.status(200).json({ ok: true, ignored: `${type}:${obj.payment_status}` });
      }
      const userId = await resolveUser(obj);
      if (!userId) return res.status(200).json({ ok: true, skipped: 'no user' });
      const customer = typeof obj.customer === 'string' ? obj.customer : obj.customer?.id;
      const subscription =
        typeof obj.subscription === 'string' ? obj.subscription : obj.subscription?.id;
      await setUserPlan(userId, 'pro', null);
      // best effort: remember ids for the billing portal and future lookups
      setProfileFields(userId, {
        stripe_customer_id: customer || null,
        stripe_subscription_id: subscription || null,
      }).catch(() => {});
      if (customer) stripePost(`/v1/customers/${customer}`, { metadata: { user_id: userId } }).catch(() => {});
      return res.status(200).json({ ok: true, event: type, plan: 'pro' });
    }

    if (type.startsWith('customer.subscription.')) {
      const decision = planForSubscription(obj);
      if (!decision) return res.status(200).json({ ok: true, ignored: `${type}:${obj.status}` });
      const userId = await resolveUser(obj);
      if (!userId) return res.status(200).json({ ok: true, skipped: 'no user' });
      await setUserPlan(userId, decision.plan, decision.expires);
      return res.status(200).json({ ok: true, event: type, plan: decision.plan });
    }

    return res.status(200).json({ ok: true, ignored: type });
  } catch (err) {
    // 500 makes Stripe retry the delivery
    res.status(500).json({ error: String(err.message || err) });
  }
}
