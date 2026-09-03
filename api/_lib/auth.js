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
  if (u.status !== 200 || !u.data?.id) return { plan: 'free', userId: null };

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
  return { plan: active ? 'pro' : 'free', userId: u.data.id };
}

const bearer = (req) => String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');

// { userId, plan, token } for the signed-in user, or null when anonymous.
export async function getUser(req) {
  const token = bearer(req);
  if (!authConfigured() || !token) return null;
  try {
    const r = await cached(`plan:${token.slice(-24)}`, TTL.MIN_5, () => planForToken(token));
    return r.userId ? { ...r, token } : null;
  } catch {
    return null;
  }
}

export async function isPro(req) {
  if (!authConfigured()) return true;
  const token = bearer(req);
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

// Supabase REST helpers (PostgREST). `auth` = user token (RLS) or service role.
export function restHeaders(auth) {
  const key = auth === 'service' ? service() : anon();
  const tok = auth === 'service' ? service() : auth;
  return { apikey: key, Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' };
}
export const restUrl = (table) => `${url()}/rest/v1/${table}`;
export const hasServiceRole = () => Boolean(service());

// Returns true if the request may proceed; otherwise responds 402 itself.
export async function requirePro(req, res) {
  if (await isPro(req)) return true;
  res.status(402).json({ error: 'pro-required' });
  return false;
}

// Update a user's plan from the payment webhook (service role).
export async function setUserPlan(userId, plan, expires = null) {
  await axios.patch(
    `${url()}/rest/v1/profiles`,
    { plan, plan_expires: expires },
    {
      timeout: 8000,
      params: { id: `eq.${userId}` },
      headers: {
        apikey: service(),
        Authorization: `Bearer ${service()}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
    }
  );
}
