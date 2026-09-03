// @ts-check
// Public read-only REST API (P2-13). Auth: X-API-Key header (or ?api_key=).
// Keys are Pro-only; validated by hash with the service role; 60 req/min
// per key (per warm instance). Static datasets are served from the CDN and
// referenced by URL so API consumers do not pay the function cost.
//
//   GET /api/v1/manager/{cik}
//   GET /api/v1/holdings/{cik}[?acc=]
//   GET /api/v1/position-history/{cik}/{cusip}
//   GET /api/v1/overlap?ciks=a,b
//   GET /api/v1/datasets            -> URLs of universe / stocks / insiders / congress / performance / turkey / themes
import axios from 'axios';
import { cached, TTL } from '../_lib/cache.js';
import { restHeaders, restUrl, hasServiceRole } from '../_lib/auth.js';
import { requireFlag } from '../_lib/flags.js';
import { hashKey, looksLikeKey, createRateLimiter, parseV1Path } from '../_lib/apiKeys.js';
import { getSubmissions, list13F, getFilingHoldings, padCik } from '../_lib/sec.js';
import { mapCusipsToTickers } from '../_lib/figi.js';
import { buildTimeline } from '../_lib/positionDiff.js';
import { computeOverlap } from '../_lib/overlap.js';
import { mapLimit } from '../_lib/yahooClient.js';
import * as v from '../_lib/validate.js';

const limiter = createRateLimiter({ limit: 60, windowMs: 60_000 });
const DATASETS = ['universe', 'stocks', 'stocks-prev', 'insiders', 'congress', 'performance', 'turkey', 'themes', 'consensus', 'returns'];

/** @param {string} key */
async function resolveKey(key) {
  const hash = hashKey(key);
  return cached(`apikey:${hash.slice(0, 32)}`, TTL.MIN_5, async () => {
    if (!hasServiceRole()) throw new Error('API keys are not configured (SUPABASE_SERVICE_ROLE_KEY)');
    const r = await axios.get(restUrl('api_keys'), { headers: restHeaders('service'), params: { select: 'id,user_id,revoked_at', key_hash: `eq.${hash}` }, timeout: 8000 });
    const row = r.data?.[0];
    if (!row || row.revoked_at) return null;
    const p = await axios.get(restUrl('profiles'), { headers: restHeaders('service'), params: { select: 'plan,plan_expires', id: `eq.${row.user_id}` }, timeout: 8000 });
    const prof = p.data?.[0];
    const pro = prof?.plan === 'pro' && (!prof.plan_expires || new Date(prof.plan_expires) > new Date());
    if (!pro) return null;
    axios.patch(restUrl('api_keys'), { last_used_at: new Date().toISOString() }, { headers: restHeaders('service'), params: { id: `eq.${row.id}` }, timeout: 5000 }).catch(() => {});
    return { id: row.id, userId: row.user_id };
  });
}

/** @param {any} req @param {any} res */
export default async function handler(req, res) {
  if (!requireFlag('exportApi', res)) return;
  res.setHeader('Cache-Control', 'private, no-store');
  const key = String(req.headers['x-api-key'] || req.query.api_key || '');
  if (!looksLikeKey(key)) return res.status(401).json({ error: 'missing-or-invalid-api-key', hint: 'Send X-API-Key: 13fr_…' });
  let auth = null;
  try {
    auth = await resolveKey(key);
  } catch (/** @type {any} */ e) {
    return res.status(503).json({ error: String(e?.message || e) });
  }
  if (!auth) return res.status(401).json({ error: 'invalid-or-revoked-key' });
  const rl = limiter.check(auth.id);
  res.setHeader('X-RateLimit-Limit', String(limiter.limit));
  res.setHeader('X-RateLimit-Remaining', String(rl.remaining));
  if (!rl.ok) {
    res.setHeader('Retry-After', String(rl.retryAfterSec));
    return res.status(429).json({ error: 'rate-limited', retryAfterSec: rl.retryAfterSec });
  }

  const { resource, params } = parseV1Path(req.query.v1path || []);
  const site = `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}`;
  try {
    if (resource === 'datasets') {
      return res.status(200).json({ datasets: Object.fromEntries(DATASETS.map((d) => [d, `${site}/${d}.json`])) });
    }
    if (resource === 'manager') {
      const cik = v.cik(params[0]);
      if (!cik) return v.bad(res, 'invalid cik');
      const sub = await getSubmissions(cik);
      return res.status(200).json({ cik: padCik(cik), name: sub.name, filings: list13F(sub).map((f) => ({ acc: f.acc, form: f.form, filingDate: f.filingDate, reportDate: f.reportDate, amended: f.amended })) });
    }
    if (resource === 'holdings') {
      const cik = v.cik(params[0]);
      if (!cik) return v.bad(res, 'invalid cik');
      const sub = await getSubmissions(cik);
      const fl = list13F(sub);
      const acc = req.query.acc ? v.accession(req.query.acc) : fl[0]?.acc;
      const filing = fl.find((f) => f.acc === acc);
      if (!filing) return res.status(404).json({ error: 'filing-not-found' });
      const h = /** @type {any} */ (await getFilingHoldings(cik, filing));
      const tickers = /** @type {Record<string, string|null>} */ (await mapCusipsToTickers(h.positions.slice(0, 500).map((/** @type {any} */ p) => p.cusip)).catch(() => ({})));
      return res.status(200).json({ cik: padCik(cik), acc: filing.acc, reportDate: filing.reportDate, filingDate: filing.filingDate, aum: h.aum, count: h.positions.length, positions: h.positions.map((/** @type {any} */ p) => ({ ...p, ticker: tickers[p.cusip] ?? null })) });
    }
    if (resource === 'position-history') {
      const cik = v.cik(params[0]);
      const cusip = v.cusip(params[1]);
      if (!cik || !cusip) return v.bad(res, 'invalid cik/cusip');
      const sub = await getSubmissions(cik);
      const filings = list13F(sub).slice(0, 40).reverse();
      const filed = await mapLimit(filings, 4, async (/** @type {any} */ f) => {
        const { positions } = await getFilingHoldings(cik, f);
        const m = /** @type {any[]} */ (positions.filter((/** @type {any} */ p) => p.cusip === cusip && !p.putCall));
        const sum = (/** @type {string} */ k) => m.reduce((/** @type {number} */ s, /** @type {any} */ p) => s + (p[k] || 0), 0);
        return { reportDate: f.reportDate, snap: m.length ? { reportDate: f.reportDate, shares: sum('shares'), value: sum('value'), weight: sum('weight') } : null };
      });
      return res.status(200).json({ cik: padCik(cik), cusip, quarters: buildTimeline(filed) });
    }
    if (resource === 'overlap') {
      const ciks = [...new Set(String(req.query.ciks || '').split(',').map(v.cik).filter(Boolean))];
      if (ciks.length < 2 || ciks.length > 5) return v.bad(res, 'ciks must be 2..5 CIKs');
      const funds = await mapLimit(ciks, 3, async (/** @type {string} */ cik) => {
        const sub = await getSubmissions(cik);
        const fl = list13F(sub);
        if (!fl.length) throw new Error(`no filings for ${cik}`);
        const cur = await getFilingHoldings(cik, fl[0]);
        let prev = null;
        if (fl[1]) prev = (await getFilingHoldings(cik, fl[1]).catch(() => null))?.positions ?? null;
        return { cik: padCik(cik), name: sub.name, reportDate: fl[0].reportDate, cur: cur.positions, prev };
      });
      return res.status(200).json(computeOverlap(/** @type {any} */ (funds)));
    }
    res.status(404).json({ error: 'unknown-resource', resources: ['datasets', 'manager/{cik}', 'holdings/{cik}', 'position-history/{cik}/{cusip}', 'overlap?ciks='] });
  } catch (/** @type {any} */ err) {
    res.status(502).json({ error: String(err?.message || err) });
  }
}
