// @ts-check
import axios from 'axios';
import { getUser, restHeaders, restUrl } from '../_lib/auth.js';
import { requireFlag } from '../_lib/flags.js';
import * as v from '../_lib/validate.js';

// /api/screens — saved stock screens (Pro)
//   GET -> { items }   POST {name, params}   DELETE {id}
const MAX_SCREENS = 50;
const ALLOWED = new Set(['q', 'minFunds', 'minAdding', 'netSign', 'minNetFlow', 'minConsensus', 'sector', 'size', 'sort', 'dir']);
/** @param {any} req */
const body = (req) => (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {});

/** @param {any} req @param {any} res */
export default async function handler(req, res) {
  if (!requireFlag('screener', res)) return;
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'sign-in-required' });
  if (user.plan !== 'pro') return res.status(402).json({ error: 'pro-required' });
  const headers = restHeaders(user.token);
  try {
    if (req.method === 'GET') {
      const r = await axios.get(restUrl('saved_screens'), { headers, params: { select: 'id,name,params,created_at', order: 'created_at.desc' }, timeout: 8000 });
      return res.status(200).json({ items: r.data });
    }
    const b = body(req);
    if (req.method === 'POST') {
      const name = String(b.name || '').trim().slice(0, 60);
      if (!name) return v.bad(res, 'name required');
      const params = /** @type {Record<string, string|number>} */ ({});
      for (const [k, val] of Object.entries(b.params || {})) {
        if (!ALLOWED.has(k)) continue;
        if (typeof val === 'number' && Number.isFinite(val)) params[k] = val;
        else if (typeof val === 'string') params[k] = val.slice(0, 40);
      }
      const count = await axios.get(restUrl('saved_screens'), { headers, params: { select: 'id' }, timeout: 8000 });
      if (count.data.length >= MAX_SCREENS) return res.status(400).json({ error: 'too-many-screens', limit: MAX_SCREENS });
      const r = await axios.post(restUrl('saved_screens'), { user_id: user.userId, name, params }, { headers: { ...headers, Prefer: 'return=representation' }, timeout: 8000 });
      return res.status(200).json({ item: r.data?.[0] });
    }
    if (req.method === 'DELETE') {
      const id = String(b.id || req.query.id || '');
      if (!/^[0-9a-f-]{36}$/i.test(id)) return v.bad(res, 'invalid id');
      await axios.delete(restUrl('saved_screens'), { headers, params: { id: `eq.${id}`, user_id: `eq.${user.userId}` }, timeout: 8000 });
      return res.status(200).json({ ok: true });
    }
    res.status(405).json({ error: 'method-not-allowed' });
  } catch (/** @type {any} */ err) {
    res.status(err?.response?.status >= 400 && err?.response?.status < 500 ? 400 : 502).json({ error: String(err?.response?.data?.message || err?.message || err) });
  }
}
