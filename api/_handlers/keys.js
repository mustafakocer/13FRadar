// @ts-check
import axios from 'axios';
import { getUser, restHeaders, restUrl } from '../_lib/auth.js';
import { requireFlag } from '../_lib/flags.js';
import { generateKey } from '../_lib/apiKeys.js';
import * as v from '../_lib/validate.js';

// /api/keys — the signed-in Pro user's API keys
//   GET -> { items: [{id, name, prefix, created_at, last_used_at, revoked_at}] }
//   POST {name} -> { item, key }   (key shown once)
//   DELETE {id} -> revoke
const MAX_KEYS = 5;
/** @param {any} req */
const body = (req) => (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {});

/** @param {any} req @param {any} res */
export default async function handler(req, res) {
  if (!requireFlag('exportApi', res)) return;
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'sign-in-required' });
  if (user.plan !== 'pro') return res.status(402).json({ error: 'pro-required' });
  const headers = restHeaders(user.token);
  try {
    if (req.method === 'GET') {
      const r = await axios.get(restUrl('api_keys'), { headers, params: { select: 'id,name,prefix,created_at,last_used_at,revoked_at', order: 'created_at.desc' }, timeout: 8000 });
      return res.status(200).json({ items: r.data, limit: MAX_KEYS });
    }
    const b = body(req);
    if (req.method === 'POST') {
      const name = String(b.name || '').trim().slice(0, 60) || 'API key';
      const existing = await axios.get(restUrl('api_keys'), { headers, params: { select: 'id', revoked_at: 'is.null' }, timeout: 8000 });
      if (existing.data.length >= MAX_KEYS) return res.status(400).json({ error: 'key-limit', limit: MAX_KEYS });
      const k = generateKey();
      const r = await axios.post(restUrl('api_keys'), { user_id: user.userId, name, prefix: k.prefix, key_hash: k.hash }, { headers: { ...headers, Prefer: 'return=representation' }, timeout: 8000 });
      const row = r.data?.[0] || {};
      return res.status(200).json({ item: { id: row.id, name, prefix: k.prefix, created_at: row.created_at }, key: k.key });
    }
    if (req.method === 'DELETE') {
      const id = String(b.id || req.query.id || '');
      if (!/^[0-9a-f-]{36}$/i.test(id)) return v.bad(res, 'invalid id');
      await axios.patch(restUrl('api_keys'), { revoked_at: new Date().toISOString() }, { headers, params: { id: `eq.${id}`, user_id: `eq.${user.userId}` }, timeout: 8000 });
      return res.status(200).json({ ok: true });
    }
    res.status(405).json({ error: 'method-not-allowed' });
  } catch (/** @type {any} */ err) {
    res.status(err?.response?.status >= 400 && err?.response?.status < 500 ? 400 : 502).json({ error: String(err?.response?.data?.message || err?.message || err) });
  }
}
