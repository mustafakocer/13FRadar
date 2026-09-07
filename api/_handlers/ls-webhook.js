import crypto from 'node:crypto';
import { authConfigured, setUserPlan } from '../_lib/auth.js';

// Lemon Squeezy subscription webhook.
//
// Setup (Lemon Squeezy → Settings → Webhooks):
//   URL:            https://<site>/api/ls-webhook
//   Signing secret: the same value as the LS_WEBHOOK_SECRET env var on Vercel
//   Events:         subscription_created, subscription_updated, subscription_cancelled,
//                   subscription_resumed, subscription_expired, subscription_paused,
//                   subscription_unpaused, subscription_plan_changed
//
// Every delivery is authenticated with the X-Signature header: HMAC-SHA256 of
// the raw request body keyed with the signing secret. The checkout must pass
// checkout[custom][user_id] (the Pricing page does) so we know which Supabase
// user to upgrade.

// Only subscription *lifecycle* events carry a subscription object whose
// `status` describes access. subscription_payment_* events carry an invoice
// whose status is "paid"/"pending"/"refunded" — those must never touch plans.
const LIFECYCLE_EVENTS = new Set([
  'subscription_created',
  'subscription_updated',
  'subscription_resumed',
  'subscription_unpaused',
  'subscription_cancelled',
  'subscription_expired',
  'subscription_paused',
  'subscription_plan_changed',
]);
// Statuses that keep access. past_due keeps access during dunning; a failed
// dunning cycle ends with subscription_expired (status "expired" → free).
const ACTIVE_STATUSES = new Set(['active', 'on_trial', 'past_due']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The signature covers the exact bytes Lemon Squeezy sent, so the body has
// to be read raw from the request stream. Vercel's Node helpers consume the
// stream to build req.body but replay it afterwards, so 'data'/'end' listeners
// still receive the original bytes; the local dev server never touches it.
function readRawBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve(Buffer.concat(chunks).toString('utf8'));
    };
    req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on('end', finish);
    req.on('error', finish);
    setTimeout(finish, 3000); // never hang a delivery
  }).then((raw) => {
    if (raw) return raw;
    const b = req.body;
    if (typeof b === 'string') return b;
    if (Buffer.isBuffer(b)) return b.toString('utf8');
    return null; // parsed object only — the original bytes are gone
  });
}

function signatureValid(raw, header, secret) {
  if (!header || !secret) return false;
  const expected = Buffer.from(crypto.createHmac('sha256', secret).update(raw).digest('hex'), 'utf8');
  const given = Buffer.from(String(header).trim().toLowerCase(), 'utf8');
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

// Exported for tests: decide the plan for one lifecycle event.
export function planForEvent(event, attrs = {}) {
  if (!LIFECYCLE_EVENTS.has(event)) return null; // not our business
  const status = String(attrs.status || '');
  if (ACTIVE_STATUSES.has(status)) return { plan: 'pro', expires: null };
  if (status === 'cancelled') {
    // access continues until the end of the paid period
    const ends = attrs.ends_at ? new Date(attrs.ends_at) : null;
    if (ends && ends > new Date()) return { plan: 'pro', expires: ends.toISOString() };
    return { plan: 'free', expires: null };
  }
  return { plan: 'free', expires: null }; // expired, unpaid, paused
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  // Read the raw bytes first so a misconfigured body parser is visible even
  // before the signing secret is set up.
  const raw = await readRawBody(req);
  if (raw == null) return res.status(500).json({ error: 'raw-body-unavailable' });

  const secret = process.env.LS_WEBHOOK_SECRET;
  if (!secret) return res.status(500).json({ error: 'Webhook not configured' });

  if (!signatureValid(raw, req.headers['x-signature'], secret)) {
    return res.status(401).json({ error: 'Bad signature' });
  }
  if (!authConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Auth not configured' });
  }

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const event = String(body?.meta?.event_name || '');
  const decision = planForEvent(event, body?.data?.attributes || {});
  if (!decision) return res.status(200).json({ ok: true, ignored: event });

  const userId = String(body?.meta?.custom_data?.user_id || '');
  if (!UUID_RE.test(userId)) return res.status(200).json({ ok: true, skipped: 'no user_id' });

  try {
    await setUserPlan(userId, decision.plan, decision.expires);
    res.status(200).json({ ok: true, event, plan: decision.plan });
  } catch (err) {
    // 500 makes Lemon Squeezy retry the delivery
    res.status(500).json({ error: String(err.message || err) });
  }
}
