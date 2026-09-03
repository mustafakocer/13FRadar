// @ts-check
import axios from 'axios';
import { getUser, restHeaders, restUrl } from '../_lib/auth.js';
import { LIMITS } from '../_lib/plan.js';
import { requireFlag } from '../_lib/flags.js';
import * as v from '../_lib/validate.js';

// /api/alerts — the signed-in user's alert subscriptions (RLS via user token)
//   GET            -> { items: [{kind, key, label, created_at}], limit }
//   POST  {kind,key,label} -> { item }   (402 when the free limit is reached)
//   DELETE {kind,key} (body or query)   -> { ok: true }
const KINDS = ['fund', 'stock'];

/** @param {any} req */
function body(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return req.body;
}

/** @param {any} req @param {any} res */
export default async function handler(req, res) {
  if (!requireFlag('alerts', res)) return;
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'sign-in-required' });
  const headers = restHeaders(user.token);
  const plan = /** @type {'free'|'pro'} */ (user.plan === 'pro' ? 'pro' : 'free');
  const limit = LIMITS[plan].alerts;

  try {
    if (req.method === 'GET') {
      const r = await axios.get(restUrl('alert_subscriptions'), {
        headers,
        params: { select: 'kind,key,label,created_at', order: 'created_at.desc' },
        timeout: 8000,
      });
      return res.status(200).json({ items: r.data, limit: Number.isFinite(limit) ? limit : null, plan });
    }

    const b = { ...req.query, ...body(req) };
    const kind = v.oneOf(b.kind, KINDS, '');
    const key = kind === 'fund' ? v.cik(b.key)?.padStart(10, '0') : kind === 'stock' ? v.cusip(b.key) : null;
    if (!kind || !key) return v.bad(res, 'kind must be fund|stock and key a valid CIK/CUSIP');

    if (req.method === 'POST') {
      const label = String(b.label || '').slice(0, 120);
      const count = await axios.get(restUrl('alert_subscriptions'), {
        headers: { ...headers, Prefer: 'count=exact' },
        params: { select: 'id', limit: 1 },
        timeout: 8000,
      });
      const n = Number(String(count.headers['content-range'] || '').split('/')[1] || 0);
      if (n >= limit) return res.status(402).json({ error: 'alert-limit', limit });
      const r = await axios.post(
        restUrl('alert_subscriptions'),
        { user_id: user.userId, kind, key, label },
        { headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=representation' }, timeout: 8000 }
      );
      return res.status(200).json({ item: r.data?.[0] || { kind, key, label }, limit: Number.isFinite(limit) ? limit : null });
    }

    if (req.method === 'DELETE') {
      await axios.delete(restUrl('alert_subscriptions'), {
        headers,
        params: { user_id: `eq.${user.userId}`, kind: `eq.${kind}`, key: `eq.${key}` },
        timeout: 8000,
      });
      return res.status(200).json({ ok: true });
    }
    res.status(405).json({ error: 'method-not-allowed' });
  } catch (/** @type {any} */ err) {
    const status = err?.response?.status;
    res.status(status && status >= 400 && status < 500 ? 400 : 502).json({ error: String(err?.response?.data?.message || err?.message || err) });
  }
}
