// @ts-check
import axios from 'axios';
import { getUser, restHeaders, restUrl } from '../_lib/auth.js';
import { LIMITS } from '../_lib/plan.js';
import { requireFlag } from '../_lib/flags.js';
import * as v from '../_lib/validate.js';

// /api/groups — fund groups
//   GET                                   -> { groups: [{id,name,weighting,members:[{cik,name}]}], limits }
//   POST {action:'create', name, weighting}
//   POST {action:'rename', id, name, weighting}
//   POST {action:'add', id, cik, name}
//   POST {action:'remove', id, cik}
//   DELETE {id}
/** @param {any} req */
const body = (req) => (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {});

/** @param {any} req @param {any} res */
export default async function handler(req, res) {
  if (!requireFlag('watchlists', res)) return;
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'sign-in-required' });
  const plan = /** @type {'free'|'pro'} */ (user.plan === 'pro' ? 'pro' : 'free');
  const lim = { groups: LIMITS[plan].groups, members: LIMITS[plan].groupMembers };
  const headers = restHeaders(user.token);
  const get = (/** @type {string} */ table, /** @type {any} */ params) => axios.get(restUrl(table), { headers, params, timeout: 8000 }).then((r) => r.data);

  try {
    if (req.method === 'GET') {
      const groups = await get('fund_groups', { select: 'id,name,weighting,created_at', order: 'created_at.asc' });
      const members = groups.length ? await get('fund_group_members', { select: 'group_id,cik,name', group_id: `in.(${groups.map((/** @type {any} */ g) => g.id).join(',')})` }) : [];
      for (const g of groups) g.members = members.filter((/** @type {any} */ m) => m.group_id === g.id).map((/** @type {any} */ m) => ({ cik: m.cik, name: m.name }));
      return res.status(200).json({ groups, limits: { groups: Number.isFinite(lim.groups) ? lim.groups : null, members: lim.members }, plan });
    }
    const b = body(req);
    if (req.method === 'DELETE') {
      const id = String(b.id || req.query.id || '');
      if (!/^[0-9a-f-]{36}$/i.test(id)) return v.bad(res, 'invalid id');
      await axios.delete(restUrl('fund_groups'), { headers, params: { id: `eq.${id}`, user_id: `eq.${user.userId}` }, timeout: 8000 });
      return res.status(200).json({ ok: true });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'method-not-allowed' });
    const action = v.oneOf(b.action, ['create', 'rename', 'add', 'remove'], '');
    if (!action) return v.bad(res, 'invalid action');

    if (action === 'create') {
      const name = String(b.name || '').trim().slice(0, 60);
      const weighting = v.oneOf(b.weighting, ['aum', 'equal'], 'aum');
      if (!name || !weighting) return v.bad(res, 'name required');
      const existing = await get('fund_groups', { select: 'id' });
      if (existing.length >= lim.groups) return res.status(402).json({ error: 'group-limit', limit: lim.groups });
      const r = await axios.post(restUrl('fund_groups'), { user_id: user.userId, name, weighting }, { headers: { ...headers, Prefer: 'return=representation' }, timeout: 8000 });
      return res.status(200).json({ group: { ...r.data[0], members: [] } });
    }
    const id = String(b.id || '');
    if (!/^[0-9a-f-]{36}$/i.test(id)) return v.bad(res, 'invalid id');
    if (action === 'rename') {
      const patch = /** @type {Record<string, string>} */ ({});
      if (b.name) patch.name = String(b.name).trim().slice(0, 60);
      const w = b.weighting ? v.oneOf(b.weighting, ['aum', 'equal'], '') : null;
      if (b.weighting && !w) return v.bad(res, 'invalid weighting');
      if (w) patch.weighting = w;
      await axios.patch(restUrl('fund_groups'), patch, { headers, params: { id: `eq.${id}`, user_id: `eq.${user.userId}` }, timeout: 8000 });
      return res.status(200).json({ ok: true });
    }
    const cik = v.cik(b.cik)?.padStart(10, '0');
    if (!cik) return v.bad(res, 'invalid cik');
    if (action === 'add') {
      const members = await get('fund_group_members', { select: 'cik', group_id: `eq.${id}` });
      if (members.length >= lim.members) return res.status(402).json({ error: 'member-limit', limit: lim.members });
      await axios.post(restUrl('fund_group_members'), { group_id: id, user_id: user.userId, cik, name: String(b.name || '').slice(0, 120) }, { headers: { ...headers, Prefer: 'resolution=merge-duplicates' }, timeout: 8000 });
      return res.status(200).json({ ok: true });
    }
    await axios.delete(restUrl('fund_group_members'), { headers, params: { group_id: `eq.${id}`, cik: `eq.${cik}`, user_id: `eq.${user.userId}` }, timeout: 8000 });
    return res.status(200).json({ ok: true });
  } catch (/** @type {any} */ err) {
    res.status(err?.response?.status >= 400 && err?.response?.status < 500 ? 400 : 502).json({ error: String(err?.response?.data?.message || err?.message || err) });
  }
}
