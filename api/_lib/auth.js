import axios from 'axios';
import { cached, TTL } from './cache.js';

// Server-side plan check against Supabase. If SUPABASE_URL isn't configured
// yet, everything is treated as Pro so the site keeps working pre-launch.
const url = () => (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const anon = () => process.env.SUPABASE_ANON_KEY || '';
const service = () => process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export const authConfigured = () => Boolean(url() && anon() && service());

async function planForToken(token) {
  const u = await axios.get(`${url()}/auth/v1/user`, {
    timeout: 8000,
    validateStatus: () => true,
    headers: { apikey: anon(), Authorization: `Bearer ${token}` },
  });
  if (u.status !== 200 || !u.data?.id) return { plan: 'free', userId: null };

  const p = await axios.get(`${url()}/rest/v1/profiles`, {
    timeout: 8000,
    validateStatus: () => true,
    params: { id: `eq.${u.data.id}`, select: 'plan,plan_expires' },
    headers: { apikey: service(), Authorization: `Bearer ${service()}` },
  });
  const row = p.data?.[0];
  const active =
    row?.plan === 'pro' &&
    (!row.plan_expires || new Date(row.plan_expires) > new Date());
  return { plan: active ? 'pro' : 'free', userId: u.data.id };
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
