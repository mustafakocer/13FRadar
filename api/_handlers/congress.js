import { readServed } from '../_lib/congressStore.js';
import { feed, memberView, membersList, overview, tickerView } from '../_lib/congressModel.js';

// Congress trades (STOCK Act periodic transaction reports), free to read.
//   GET /api/congress                 the overview: latest, most bought/sold, most active, largest
//   GET /api/congress-feed?ch=&p=&kind=&ticker=&q=&offset=&limit=   the filterable list
//   GET /api/congress-members         every member with a trade on file
//   GET /api/congress-member/:slug    one member's trades
//   GET /api/congress-ticker/:ticker  trades in one stock
// The file changes only with a data commit (a deploy), so an hour at the CDN
// is safe.
const CACHE = 's-maxage=3600, stale-while-revalidate=86400';
const send = (res, body) => {
  if (!body) return res.status(404).json({ error: 'Not found' });
  res.setHeader('Cache-Control', CACHE);
  return res.status(200).json(body);
};
const one = (v) => (Array.isArray(v) ? v[0] : v);
const pick = (v, allowed) => (allowed.includes(one(v)) ? one(v) : undefined);

export function congressOverview(req, res) {
  const db = readServed();
  if (!db.rows.length) return res.status(503).json({ error: 'congress data not built' });
  return send(res, overview(db));
}

export function congressFeed(req, res) {
  const q = req.query || {};
  const db = readServed();
  return send(res, {
    updatedAt: db.updatedAt,
    ...feed(db, {
      ch: pick(q.ch, ['H', 'S']),
      p: pick(q.p, ['D', 'R', 'I']),
      kind: pick(q.kind, ['buy', 'sell']),
      ticker: one(q.ticker) ? String(one(q.ticker)).slice(0, 12) : undefined,
      member: one(q.member) ? String(one(q.member)).slice(0, 120) : undefined,
      q: one(q.q) ? String(one(q.q)).slice(0, 80) : undefined,
      offset: one(q.offset),
      limit: one(q.limit),
    }),
  });
}

export function congressMembers(req, res) {
  const db = readServed();
  return send(res, { updatedAt: db.updatedAt, members: membersList(db) });
}

export function congressMember(req, res) {
  const slug = String(one(req.query?.slug) || '').toLowerCase();
  return send(res, /^[a-z0-9-]{1,120}$/.test(slug) ? memberView(readServed(), slug) : null);
}

export function congressTicker(req, res) {
  const t = String(one(req.query?.ticker) || '').toUpperCase();
  return send(res, /^[A-Z0-9.\-]{1,12}$/.test(t) ? tickerView(readServed(), t) : null);
}
