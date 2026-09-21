import { authConfigured, hasServiceKey, stripeEventSeen, applyStripeEvent, findUserByCustomer } from '../_lib/auth.js';
import {
  verifyStripeSignature,
  readRawBody,
  planForSubscription,
  periodEndOf,
  unixToIso,
  stripePost,
  stripeGet,
} from '../_lib/stripe.js';

// Stripe webhook — Stripe dashboard → Developers → Webhooks → Add endpoint:
//   URL:    https://<site>/api/stripe-webhook
//   Events: checkout.session.completed, customer.subscription.created,
//           customer.subscription.updated, customer.subscription.deleted,
//           invoice.payment_failed
// Put the endpoint's signing secret (whsec_…) in STRIPE_WEBHOOK_SECRET.
//
// Idempotent: every delivery is keyed by its Stripe event id in
// public.stripe_events. A second delivery of an id already there is answered
// 200 and changes nothing. The event row and the profile change are written
// in one database transaction (public.apply_stripe_event), so a crash between
// the two cannot leave one without the other; any failure answers 500 and
// Stripe retries the delivery.
//
// What each event does to profiles:
//   checkout.session.completed     plan=pro, stripe ids, plan_expires=current_period_end
//   customer.subscription.updated  plan_expires=current_period_end; canceled/unpaid → plan=free
//   customer.subscription.deleted  plan=free, plan_expires=null
//   invoice.payment_failed         nothing (logged). Stripe retries the charge;
//                                  the grace period is Stripe's Smart Retries,
//                                  not code here.
//
// The Supabase user is client_reference_id / metadata.user_id, both set by
// /api/checkout to the auth uid, with a fallback lookup by the Stripe customer
// id stored on the profile. Never by e-mail address.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EVENT_ID_RE = /^evt_[A-Za-z0-9]+$/;

const idOf = (x) => (typeof x === 'string' ? x : x?.id) || null;

async function resolveUser(obj) {
  const direct =
    obj?.client_reference_id ||
    obj?.metadata?.user_id ||
    obj?.subscription_details?.metadata?.user_id || // invoice
    obj?.parent?.subscription_details?.metadata?.user_id; // invoice, 2025+ API shape
  if (UUID_RE.test(String(direct || ''))) return String(direct);
  const customer = idOf(obj?.customer);
  if (customer) {
    try {
      return await findUserByCustomer(customer);
    } catch {
      /* fall through */
    }
  }
  return null;
}

// What one event does: { userId, patch, outcome, customer }. Throws when
// something it needs (the subscription behind a checkout) cannot be fetched,
// which turns into a 500 and a retry from Stripe.
async function decide(type, obj) {
  if (type === 'checkout.session.completed') {
    if (obj.mode !== 'subscription') return { outcome: `ignored:mode=${obj.mode || '?'}` };
    if (!['paid', 'no_payment_required'].includes(obj.payment_status)) {
      return { outcome: `ignored:${obj.payment_status || 'unpaid'}` };
    }
    const userId = await resolveUser(obj);
    if (!userId) return { outcome: 'skipped:no-user' };
    const customer = idOf(obj.customer);
    const subscription = idOf(obj.subscription);
    // the session does not carry the period end; the subscription does
    const sub = subscription ? await stripeGet(`/v1/subscriptions/${subscription}`) : null;
    return {
      userId,
      customer,
      outcome: 'applied',
      patch: {
        plan: 'pro',
        plan_expires: unixToIso(periodEndOf(sub)),
        stripe_customer_id: customer,
        stripe_subscription_id: subscription,
      },
    };
  }

  if (type === 'customer.subscription.deleted') {
    const userId = await resolveUser(obj);
    if (!userId) return { outcome: 'skipped:no-user' };
    return { userId, outcome: 'applied', patch: { plan: 'free', plan_expires: null, stripe_subscription_id: null } };
  }

  if (type === 'customer.subscription.created' || type === 'customer.subscription.updated') {
    const decision = planForSubscription(obj);
    if (!decision) return { outcome: `ignored:${obj.status}` };
    const userId = await resolveUser(obj);
    if (!userId) return { outcome: 'skipped:no-user' };
    const patch = { plan: decision.plan, plan_expires: decision.expires };
    // the ids too, in case this arrived before checkout.session.completed
    if (idOf(obj.customer)) patch.stripe_customer_id = idOf(obj.customer);
    if (obj.id) patch.stripe_subscription_id = obj.id;
    return { userId, customer: idOf(obj.customer), outcome: 'applied', patch };
  }

  if (type === 'invoice.payment_failed') {
    const userId = await resolveUser(obj);
    console.warn(
      `stripe: payment failed for invoice ${obj.id || '?'} (customer ${idOf(obj.customer) || '?'}, user ${userId || 'unknown'}); Stripe retries, plan untouched`
    );
    return { userId, outcome: 'logged' };
  }

  return { outcome: 'ignored' };
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
  if (!authConfigured() || !hasServiceKey()) {
    return res.status(500).json({ error: 'Auth not configured' });
  }

  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }
  const id = String(event?.id || '');
  if (!EVENT_ID_RE.test(id)) return res.status(400).json({ error: 'missing event id' });
  const type = String(event?.type || '');
  const obj = event?.data?.object || {};

  try {
    if (await stripeEventSeen(id)) {
      return res.status(200).json({ ok: true, duplicate: true, event: type });
    }
    const d = await decide(type, obj);
    const result = await applyStripeEvent({
      id,
      type,
      userId: d.userId || null,
      patch: d.patch || {},
      outcome: d.outcome,
    });
    const duplicate = result === 'duplicate';
    if (!duplicate && d.customer && d.userId) {
      // best effort: the customer carries our user id for the billing portal
      stripePost(`/v1/customers/${d.customer}`, { metadata: { user_id: d.userId } }).catch(() => {});
    }
    return res.status(200).json({
      ok: true,
      duplicate,
      event: type,
      result,
      plan: duplicate ? null : (d.patch?.plan ?? null),
    });
  } catch (err) {
    // 500 makes Stripe retry the delivery
    res.status(500).json({ error: String(err.message || err) });
  }
}
