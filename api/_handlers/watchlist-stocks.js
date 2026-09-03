// @ts-check
import axios from 'axios';
import { getUser, restHeaders, restUrl } from '../_lib/auth.js';
import { LIMITS } from '../_lib/plan.js';
import { requireFlag } from '../_lib/flags.js';
import * as v from '../_lib/validate.js';

// /api/watchlist-stocks — the signed-in user's stock watchlist
//   GET -> { items, limit }   POST {cusip,ticker,name}   DELETE {cusip}
/** @param {any} req */
const body = (req) => (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {});

/** @param {any} req @param {any} res */
export default async function handler(req, res) {
  if (!requireFlag('watchlists', res)) return;
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'sign-in-required' });
  const plan = /** @type {'free'|'pro'} */ (user.plan === 'pro' ? 'pro' : 'free');
  const limit = LIMITS[plan].watchlist;
  const headers = restHeaders(user.token);
  try {
    if (req.method === 'GET') {
      const r = await axios.get(restUrl('stock_watchlist'), { headers, params: { select: 'cusip,ticker,name,created_at', order: 'created_at.desc' }, timeout: 8000 });
      return res.status(200).json({ items: r.data, limit: Number.isFinite(limit) ? limit : null, plan });
    }
    const b = { ...req.query, ...body(req) };
    const cusip = v.cusip(b.cusip);
    if (!cusip) return v.bad(res, 'invalid cusip');
    if (req.method === 'POST') {
      const count = await axios.get(restUrl('stock_watchlist'), { headers: { ...headers, Prefer: 'count=exact' }, params: { select: 'cusip', limit: 1 }, timeout: 8000 });
      const n = Number(String(count.headers['content-range'] || '').split('/')[1] || 0);
      if (n >= limit) return res.status(402).json({ error: 'watchlist-limit', limit });
      const ticker = b.ticker ? v.ticker(b.ticker) : null;
      const r = await axios.post(
        restUrl('stock_watchlist'),
        { user_id: user.userId, cusip, ticker, name: String(b.name || '').slice(0, 120) },
        { headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=representation' }, timeout: 8000 }
      );
      return res.status(200).json({ item: r.data?.[0] });
    }
    if (req.method === 'DELETE') {
      await axios.delete(restUrl('stock_watchlist'), { headers, params: { user_id: `eq.${user.userId}`, cusip: `eq.${cusip}` }, timeout: 8000 });
      return res.status(200).json({ ok: true });
    }
    res.status(405).json({ error: 'method-not-allowed' });
  } catch (/** @type {any} */ err) {
    res.status(err?.response?.status >= 400 && err?.response?.status < 500 ? 400 : 502).json({ error: String(err?.response?.data?.message || err?.message || err) });
  }
}
