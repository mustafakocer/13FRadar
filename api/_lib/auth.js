import axios from 'axios';
import { cached, TTL } from './cache.js';

// Server-side plan check against Supabase. If the URL/anon key aren't
// configured yet, everything is treated as Pro so the site keeps working
// pre-launch. Public defaults are baked in below (anon keys are public by
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
  if (u.status !== 200 || !u.data?.id) return { plan: 'free', userId: null, email: null };

  // RLS lets the user read their own profile row with their own token,
  // so no service role key is needed for plan checks.
  const p = await axios.get(`${url()}/rest/v1/profiles`, {
    timeout: 8000,
    validateStatus: () => true,
    params: { id: `eq.${u.data.id}`, select: 'plan,plan_expires' },
    headers: { apikey: anon(), Authorization: `Bearer ${token}` },
  });
  const row = p.data?.[0];
  const active =
    row?.plan === 'pro' &&
    (!row.plan_expires || new Date(row.plan_expires) > new Date());
  return { plan: active ? 'pro' : 'free', userId: u.data.id, email: u.data.email || null };
}

// Signed-in user (id, email, plan) or null. Cached per token for 5 minutes.
export async function getUser(req) {
  if (!authConfigured()) return null;
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  try {
    const r = await cached(`plan:${token.slice(-24)}`, TTL.MIN_5, () => planForToken(token));
    return r.userId ? { id: r.userId, email: r.email, plan: r.plan } : null;
  } catch {
    return null;
  }
}

export async function isPro(req) {
  if (!authConfigured()) return true;
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return false;
  try {
    const { plan } = await cached(`plan:${token.slice(-24)}`, TTL.MIN_5, () =>
      planForToken(token)
    );
    return plan === 'pro';
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

// ---- service-role access (payment webhook / checkout only) -----------------
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

// Update a user's plan from the payment webhook (service role).
export function setUserPlan(userId, plan, expires = null) {
  return svcPatch(userId, { plan, plan_expires: expires });
}

// Extra billing columns (stripe_customer_id, …). Callers treat failure as
// non-fatal so an older schema without the columns keeps working.
export function setProfileFields(userId, fields) {
  return svcPatch(userId, fields);
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
