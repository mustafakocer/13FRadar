import {
  authConfigured,
  hasServiceKey,
  stripeEventSeen,
  applyStripeEvent,
  findUserByCustomer,
  findProfileByCustomer,
} from '../_lib/auth.js';
import {
  verifyStripeSignature,
  readRawBody,
  planForSubscription,
  periodEndOf,
  periodStartOf,
  subscriptionOwner,
  unixToIso,
  stripePost,
  stripeGet,
} from '../_lib/stripe.js';
import { sendMetaEvent } from '../_lib/metaCapi.js';

// Stripe webhook — Stripe dashboard → Developers → Webhooks → Add endpoint:
//   URL:    https://<site>/api/stripe-webhook
//   Events: checkout.session.completed, customer.subscription.created,
//           customer.subscription.updated, customer.subscription.deleted,
//           invoice.payment_failed, charge.refunded,
//           charge.dispute.created, charge.dispute.closed
// Put the endpoint's signing secret (whsec_…) in STRIPE_WEBHOOK_SECRET.
//
// Idempotent: every delivery is keyed by its Stripe event id in
// public.stripe_events. A second delivery of an id already there is answered
// 200 and changes nothing. The event row and the profile change are written
// in one database transaction (public.apply_stripe_event), so a crash between
// the two cannot leave one without the other; any failure answers 500 and
// Stripe retries the delivery.
//
// Ordered: Stripe does not deliver events in the order they happened. Each
// profile remembers the `created` time of the last Stripe event that changed
// it (profiles.stripe_event_at, migration 0008), and an event older than that
// is recorded as ignored:stale and changes nothing — a late
// subscription.updated(active) cannot re-open Pro after the deleted that
// followed it.
//
// What each event does to profiles:
//   checkout.session.completed     plan=pro, stripe ids, plan_expires=current_period_end
//   customer.subscription.updated  active/trialing: plan_expires=current_period_end;
//                                  past_due: plan_expires=period start + grace
//                                  (PAST_DUE_GRACE_DAYS), never the unpaid
//                                  period's end; canceled/unpaid → plan=free
//   customer.subscription.deleted  plan=free, plan_expires=null
//   invoice.payment_failed         nothing (logged). Stripe retries the charge.
//   charge.refunded                the charge that paid the current period,
//                                  refunded in full → plan=free. A partial
//                                  refund, or one of an earlier period's
//                                  charge, is logged and changes nothing.
//   charge.dispute.created         plan=free at once (the money is withdrawn)
//   charge.dispute.closed          lost → plan=free; won → logged, nothing is
//                                  restored: the next subscription event of a
//                                  still-paying customer does that.
// The handler only reads from Stripe for these (the subscription, and the
// charge behind a dispute). It never cancels or refunds anything: when you
// refund a customer, cancel the subscription in Stripe too ("cancel
// immediately"), or the next renewal — or a "cancel at period end", which
// arrives as an active subscription — opens Pro again.
//
// Only our own product's subscriptions count. The Stripe account also sells
// other products and Stripe sends their events here too, so every path that
// changes a plan first checks the subscription's price against the configured
// STRIPE_PRICE_* ids (subscriptionOwner in _lib/stripe.js):
//   own           acted on as above
//   foreign       recorded as ignored:foreign-price, profile untouched — no
//                 grant, and no downgrade either: another product's
//                 cancellation is not ours to act on
//   unconfigured  (no price id set at all) nothing is granted — recorded as
//                 ignored:prices-not-configured — because an unverifiable
//                 payment must not open Pro; a cancellation still takes Pro
//                 away from a user it resolves to, the safe direction.
//                 /api/checkout cannot start a purchase in this state, so no
//                 buyer of ours is lost to it.
//
// The Supabase user is client_reference_id / metadata.user_id, both set by
// /api/checkout to the auth uid, with a fallback lookup by the Stripe customer
// id stored on the profile. Never by e-mail address.
//
// A first-time checkout.session.completed that /api/checkout marked with
// metadata.meta_consent=1 (the buyer accepted marketing cookies) is also
// reported to Meta as a Purchase, event id purchase_<session id> — the same
// id the success page's fbq() uses, so Meta counts it once.
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

// Why a subscription may not change a profile, or null when it may. `grants`
// says whether the change would open Pro.
function refusal(sub, grants) {
  const owner = subscriptionOwner(sub);
  if (owner === 'foreign') return 'ignored:foreign-price';
  if (owner === 'unconfigured' && grants) return 'ignored:prices-not-configured';
  return null;
}

// A renewal's charge is created at the period start, a retried one after it;
// the slack only absorbs clock differences between the two objects.
const CHARGE_BEFORE_PERIOD_SEC = 3600;

// Whose account a charge belongs to, for a refund or a dispute:
// { userId, sub } when it is one of ours, { outcome[, userId] } when the event
// ends here. A charge carries no price, so "ours" is established through the
// profile: the customer id must be stored on a profile (only our own checkout
// puts it there — another product's customers are on none, and stop at
// skipped:no-user without a call to Stripe), and that profile's subscription,
// read from Stripe, must belong to the same customer and be on one of our
// prices. `verify` false resolves the user for the log only.
async function chargeAccount(charge, verify) {
  const customer = idOf(charge?.customer);
  if (!customer) return { outcome: 'skipped:no-user' };
  const profile = await findProfileByCustomer(customer);
  if (!profile?.id) return { outcome: 'skipped:no-user' };
  if (!verify) return { userId: profile.id };
  // no live subscription on the profile: there is no access of ours to end
  if (!profile.stripe_subscription_id) return { userId: profile.id, outcome: 'ignored:no-subscription' };
  const sub = await stripeGet(`/v1/subscriptions/${profile.stripe_subscription_id}`);
  if (idOf(sub?.customer) !== customer) return { userId: profile.id, outcome: 'ignored:customer-mismatch' };
  const refused = refusal(sub, false);
  if (refused) return { userId: profile.id, outcome: refused };
  return { userId: profile.id, sub };
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
    const refused = refusal(sub, true);
    if (refused) return { outcome: refused };
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
    const refused = refusal(obj, false);
    if (refused) return { outcome: refused };
    const userId = await resolveUser(obj);
    if (!userId) return { outcome: 'skipped:no-user' };
    return { userId, outcome: 'applied', patch: { plan: 'free', plan_expires: null, stripe_subscription_id: null } };
  }

  if (type === 'customer.subscription.created' || type === 'customer.subscription.updated') {
    const decision = planForSubscription(obj);
    if (!decision) return { outcome: `ignored:${obj.status}` };
    const refused = refusal(obj, decision.plan === 'pro');
    if (refused) return { outcome: refused };
    const userId = await resolveUser(obj);
    if (!userId) return { outcome: 'skipped:no-user' };
    const patch = { plan: decision.plan, plan_expires: decision.expires };
    // the ids too, in case this arrived before checkout.session.completed
    if (idOf(obj.customer)) patch.stripe_customer_id = idOf(obj.customer);
    if (obj.id) patch.stripe_subscription_id = obj.id;
    return { userId, customer: idOf(obj.customer), outcome: 'applied', patch };
  }

  if (type === 'charge.refunded') {
    if (!obj.refunded) return { ...(await chargeAccount(obj, false)), patch: undefined, outcome: 'logged:partial-refund' };
    const acc = await chargeAccount(obj, true);
    if (acc.outcome) return acc;
    // only the charge that paid for the period the account is in ends it; a
    // goodwill refund of an earlier month leaves the current, paid one alone
    const start = Number(periodStartOf(acc.sub));
    if (Number.isFinite(start) && start > 0 && Number(obj.created) < start - CHARGE_BEFORE_PERIOD_SEC) {
      return { userId: acc.userId, outcome: 'logged:refund-earlier-period' };
    }
    return { userId: acc.userId, outcome: 'applied', patch: { plan: 'free', plan_expires: null } };
  }

  if (type === 'charge.dispute.created' || type === 'charge.dispute.closed') {
    const closed = type === 'charge.dispute.closed';
    const status = String(obj.status || '?');
    const cuts = !closed || status === 'lost';
    // the dispute names its charge; the customer is on the charge
    const chargeId = idOf(obj.charge);
    if (!chargeId) return { outcome: 'skipped:no-charge' };
    const charge = typeof obj.charge === 'object' ? obj.charge : await stripeGet(`/v1/charges/${chargeId}`);
    if (!cuts) return { ...(await chargeAccount(charge, false)), patch: undefined, outcome: `logged:dispute-${status}` };
    const acc = await chargeAccount(charge, true);
    if (acc.outcome) return acc;
    return { userId: acc.userId, outcome: 'applied', patch: { plan: 'free', plan_expires: null } };
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

function reportPurchase(obj, userId, created) {
  const m = obj.metadata || {};
  if (m.meta_consent !== '1' || !obj.id) return null;
  const currency = String(obj.currency || '').toUpperCase();
  const value = Number.isFinite(obj.amount_total) ? obj.amount_total / 100 : undefined;
  return sendMetaEvent({
    name: 'Purchase',
    id: `purchase_${obj.id}`,
    time: created,
    email: obj.customer_details?.email || obj.customer_email,
    externalId: userId,
    country: obj.customer_details?.address?.country,
    ip: m.meta_ip,
    ua: m.meta_ua,
    fbp: m.meta_fbp,
    fbc: m.meta_fbc,
    url: m.meta_url,
    custom: { currency: currency || undefined, value, content_type: 'product', content_ids: ['pro'] },
  });
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
      eventAt: Number(event.created) > 0 ? unixToIso(event.created) : null,
    });
    const duplicate = result === 'duplicate';
    const stale = result === 'ignored:stale';
    if (!duplicate && d.customer && d.userId) {
      // best effort: the customer carries our user id for the billing portal
      stripePost(`/v1/customers/${d.customer}`, { metadata: { user_id: d.userId } }).catch(() => {});
    }
    if (!duplicate && type === 'checkout.session.completed' && d.outcome === 'applied') {
      await reportPurchase(obj, d.userId, event.created); // never throws
    }
    return res.status(200).json({
      ok: true,
      duplicate,
      event: type,
      result,
      plan: duplicate || stale ? null : (d.patch?.plan ?? null),
    });
  } catch (err) {
    // 500 makes Stripe retry the delivery
    res.status(500).json({ error: String(err.message || err) });
  }
}
