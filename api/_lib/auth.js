import axios from 'axios';
import { cached, TTL } from './cache.js';

// Server-side plan check against Supabase (public.is_pro). If the URL/anon
// key aren't configured yet, everything is treated as Pro so the site keeps
// working pre-launch. Public defaults are baked in below (anon keys are public by
// design); env vars override them. The service role key is only needed by
// the payment webhook.
const PUBLIC_SUPABASE_URL = 'https://rmisfrxsnhdpcxqzmicy.supabase.co';
const PUBLIC_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJtaXNmcnhzbmhkcGN4cXptaWN5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgzNDE2NzQsImV4cCI6MjEwMzkxNzY3NH0.61AzY7NluBE0vhGKagzq42U6ZlGIt1M328JtqqfR56A';

const url = () =>
  (process.env.SUPABASE_URL || PUBLIC_SUPABASE_URL).replace(/\/$/, '');
const anon = () => process.env.SUPABASE_ANON_KEY || PUBLIC_SUPABASE_ANON_KEY;
const service = () => process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export const authConfigured = () => Boolean(url() && anon());

async function planForToken(token) {
  const u = await axios.get(`${url()}/auth/v1/user`, {
    timeout: 8000,
    validateStatus: () => true,
    headers: { apikey: anon(), Authorization: `Bearer ${token}` },
  });
  if (u.status !== 200 || !u.data?.id) return { pro: false, userId: null, email: null };

  // The one definition of Pro is public.is_pro() in the database: plan =
  // 'pro' and either no expiry or one still ahead. It runs as the caller
  // (SECURITY INVOKER), so a user's own token can only answer about the user;
  // no service key is needed for a plan check.
  const p = await axios.post(
    `${url()}/rest/v1/rpc/is_pro`,
    {},
    {
      timeout: 8000,
      validateStatus: () => true,
      headers: { apikey: anon(), Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    }
  );
  return { pro: p.status === 200 && p.data === true, userId: u.data.id, email: u.data.email || null };
}

// Signed-in user { id, email, pro } or null. Cached per token for 5 minutes.
export async function getUser(req) {
  if (!authConfigured()) return null;
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  try {
    const r = await cached(`plan:${token.slice(-24)}`, TTL.MIN_5, () => planForToken(token));
    return r.userId ? { id: r.userId, email: r.email, pro: r.pro } : null;
  } catch {
    return null;
  }
}

export async function isPro(req) {
  if (!authConfigured()) return true;
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return false;
  try {
    const { pro } = await cached(`plan:${token.slice(-24)}`, TTL.MIN_5, () => planForToken(token));
    return pro;
  } catch {
    return false;
  }
}

// Pro-only responses must never land in the shared CDN cache, where the next
// anonymous request for the same URL would be served the paid payload.
export function noStore(res) {
  res.setHeader('Cache-Control', 'private, no-store');
}

// Returns true if the request may proceed; otherwise responds 402 itself.
export async function requirePro(req, res) {
  noStore(res);
  if (await isPro(req)) return true;
  res.status(402).json({ error: 'pro-required' });
  return false;
}

// ---- service-role access (payment webhook / checkout / jobs only) ----------
const svcHeaders = () => ({
  apikey: service(),
  Authorization: `Bearer ${service()}`,
  'Content-Type': 'application/json',
});

async function svcPatch(userId, fields) {
  const r = await axios.patch(`${url()}/rest/v1/profiles`, fields, {
    timeout: 8000,
    validateStatus: () => true,
    params: { id: `eq.${userId}` },
    headers: { ...svcHeaders(), Prefer: 'return=minimal' },
  });
  if (r.status >= 300) throw new Error(`profiles update HTTP ${r.status}: ${JSON.stringify(r.data)}`);
}

// Stripe webhook bookkeeping (service role). Has this delivery been seen?
export async function stripeEventSeen(eventId) {
  const r = await axios.get(`${url()}/rest/v1/stripe_events`, {
    timeout: 8000,
    validateStatus: () => true,
    params: { id: `eq.${eventId}`, select: 'id' },
    headers: svcHeaders(),
  });
  if (r.status !== 200) throw new Error(`stripe_events read HTTP ${r.status}: ${JSON.stringify(r.data)}`);
  return Array.isArray(r.data) && r.data.length > 0;
}

// Record the event and apply the profile patch in one database transaction
// (public.apply_stripe_event). Resolves to 'duplicate' when another delivery
// of the same id got there first, otherwise to the outcome passed in.
export async function applyStripeEvent({ id, type, userId = null, patch = {}, outcome = 'applied' }) {
  const r = await axios.post(
    `${url()}/rest/v1/rpc/apply_stripe_event`,
    { p_event_id: id, p_event_type: type, p_user_id: userId, p_patch: patch, p_outcome: outcome },
    { timeout: 8000, validateStatus: () => true, headers: svcHeaders() }
  );
  if (r.status !== 200) throw new Error(`apply_stripe_event HTTP ${r.status}: ${JSON.stringify(r.data)}`);
  return String(r.data);
}

export async function getProfile(userId, select = 'plan,plan_expires') {
  const r = await axios.get(`${url()}/rest/v1/profiles`, {
    timeout: 8000,
    validateStatus: () => true,
    params: { id: `eq.${userId}`, select },
    headers: svcHeaders(),
  });
  if (r.status !== 200) throw new Error(`profiles read HTTP ${r.status}`);
  return r.data?.[0] || null;
}

// Generic service-role reads and writes for the jobs that run outside a
// request: the digest reads every enabled alert, then writes back how far it
// got. Row-level security does not apply to the service key, so these are kept
// to the table-and-filter form the callers actually need rather than a
// general-purpose client.
export async function svcSelect(table, params) {
  const r = await axios.get(`${url()}/rest/v1/${table}`, {
    timeout: 15000,
    validateStatus: () => true,
    params,
    headers: svcHeaders(),
  });
  if (r.status !== 200) throw new Error(`${table} read HTTP ${r.status}: ${JSON.stringify(r.data)}`);
  return r.data || [];
}

export async function svcUpdate(table, match, fields) {
  const r = await axios.patch(`${url()}/rest/v1/${table}`, fields, {
    timeout: 15000,
    validateStatus: () => true,
    params: match,
    headers: { ...svcHeaders(), Prefer: 'return=minimal' },
  });
  if (r.status >= 300) throw new Error(`${table} update HTTP ${r.status}: ${JSON.stringify(r.data)}`);
}

export const hasServiceKey = () => Boolean(service());

export async function findUserByCustomer(customerId) {
  const r = await axios.get(`${url()}/rest/v1/profiles`, {
    timeout: 8000,
    validateStatus: () => true,
    params: { stripe_customer_id: `eq.${customerId}`, select: 'id' },
    headers: svcHeaders(),
  });
  if (r.status !== 200) return null;
  return r.data?.[0]?.id || null;
}
