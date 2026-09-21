import crypto from 'node:crypto';
import axios from 'axios';

// Minimal Stripe REST client (no SDK): form-encoded POST/GET with the secret
// key, plus webhook signature verification. Env:
//   STRIPE_SECRET_KEY         sk_live_… / sk_test_…
//   STRIPE_WEBHOOK_SECRET     whsec_… (from the webhook endpoint in the Stripe dashboard)
//   STRIPE_PRICE_MONTHLY      price_… ($19.90 / month)
//   STRIPE_PRICE_YEARLY       price_… ($199 / year)
//   STRIPE_PRICE_MONTHLY_TR   price_… ($10 / month, shown to visitors from Türkiye)
//   STRIPE_PRICE_YEARLY_TR    price_… ($100 / year)
// STRIPE_API_BASE points the client at a stand-in during tests.
const apiBase = () => (process.env.STRIPE_API_BASE || 'https://api.stripe.com').replace(/\/$/, '');

export const hasStripe = () => !!process.env.STRIPE_SECRET_KEY;

// Which price a visitor may buy. The country comes from Vercel's IP header on
// the server, so the regional price cannot be picked by editing the client.
export function priceFor(cycle, country) {
  const tr = country === 'TR';
  const key =
    cycle === 'y'
      ? tr
        ? 'STRIPE_PRICE_YEARLY_TR'
        : 'STRIPE_PRICE_YEARLY'
      : tr
        ? 'STRIPE_PRICE_MONTHLY_TR'
        : 'STRIPE_PRICE_MONTHLY';
  // fall back to the global price when a regional one is not configured
  return (
    process.env[key] ||
    process.env[cycle === 'y' ? 'STRIPE_PRICE_YEARLY' : 'STRIPE_PRICE_MONTHLY'] ||
    null
  );
}

// {a: {b: 1}, c: [x]} -> a[b]=1&c[0]=x (Stripe's nested form encoding)
function encode(params, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(params)) {
    if (v == null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((item, i) => encode({ [i]: item }, key, out));
    else if (typeof v === 'object') encode(v, key, out);
    else out.append(key, String(v));
  }
  return out;
}

async function call(method, path, params) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY not set');
  const r = await axios({
    method,
    url: `${apiBase()}${path}`,
    timeout: 15000,
    validateStatus: () => true,
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    ...(method === 'GET' ? { params } : { data: encode(params || {}).toString() }),
  });
  if (r.status >= 400) {
    throw new Error(r.data?.error?.message || `Stripe HTTP ${r.status}`);
  }
  return r.data;
}
export const stripePost = (path, params) => call('POST', path, params);
export const stripeGet = (path, params) => call('GET', path, params);

// Stripe-Signature: t=<unix>,v1=<hex>[,v1=<hex>…]; signed payload is `${t}.${raw}`.
export function verifyStripeSignature(raw, header, secret, toleranceSec = 300) {
  if (!raw || !header || !secret) return false;
  let ts = null;
  const sigs = [];
  for (const part of String(header).split(',')) {
    const [k, v] = part.trim().split('=');
    if (k === 't') ts = Number(v);
    else if (k === 'v1' && v) sigs.push(v);
  }
  if (!ts || !sigs.length) return false;
  if (Math.abs(Date.now() / 1000 - ts) > toleranceSec) return false;
  const expected = Buffer.from(
    crypto.createHmac('sha256', secret).update(`${ts}.${raw}`).digest('hex'),
    'utf8'
  );
  return sigs.some((s) => {
    const given = Buffer.from(s, 'utf8');
    return given.length === expected.length && crypto.timingSafeEqual(given, expected);
  });
}

// Read the exact request bytes. Vercel's Node helpers consume the stream to
// build req.body but replay it, so 'data'/'end' still deliver the original
// bytes; the local dev server never touches the stream.
export function readRawBody(req) {
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
    setTimeout(finish, 3000).unref?.();
  }).then((raw) => {
    if (raw) return raw;
    const b = req.body;
    if (typeof b === 'string') return b;
    if (Buffer.isBuffer(b)) return b.toString('utf8');
    return null;
  });
}

// current_period_end lives on the subscription in older API versions and on
// its items since 2025-03; unix seconds either way.
export function periodEndOf(sub) {
  return sub?.current_period_end ?? sub?.items?.data?.[0]?.current_period_end ?? null;
}
export const unixToIso = (s) => (s ? new Date(Number(s) * 1000).toISOString() : null);

// Access decision for one Stripe subscription object: { plan, expires }.
// Pro always expires at the end of the paid period; the next renewal event
// moves it. A subscription cancelled at period end therefore needs no special
// case, and a renewal whose payment failed keeps access while Stripe's Smart
// Retries run (status past_due), until Stripe itself moves it to
// canceled/unpaid.
export function planForSubscription(sub) {
  const status = String(sub?.status || '');
  if (['active', 'trialing', 'past_due'].includes(status)) {
    return { plan: 'pro', expires: unixToIso(periodEndOf(sub)) };
  }
  if (status === 'incomplete') return null; // first payment still pending
  return { plan: 'free', expires: null }; // canceled, unpaid, incomplete_expired, paused
}
