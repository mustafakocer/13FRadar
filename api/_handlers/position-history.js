// @ts-check
import { cached, TTL } from '../_lib/cache.js';
import { getSubmissions, list13F, getFilingHoldings } from '../_lib/sec.js';
import { mapLimit } from '../_lib/yahooClient.js';
import { getPlan, LIMITS } from '../_lib/plan.js';
import { requireFlag } from '../_lib/flags.js';
import { buildTimeline } from '../_lib/positionDiff.js';
import * as v from '../_lib/validate.js';

// GET /api/position-history/:cik/:cusip?limit=16
// Timeline of one security in a manager's portfolio on a complete quarter
// grid with NEW/ADD/REDUCE/EXIT actions. Free plan: newest 2 filed quarters.
// Pro: up to MAX_QUARTERS (each extra quarter is one cached EDGAR fetch).
const MAX_QUARTERS = 40;
const DEFAULT_QUARTERS = 16;

/** @param {any} req @param {any} res */
export default async function handler(req, res) {
  if (!requireFlag('positionTimeline', res)) return;
  const cik = v.cik(req.query.cik);
  const cusip = v.cusip(req.query.cusip);
  const limit = v.intIn(req.query.limit, 2, MAX_QUARTERS, DEFAULT_QUARTERS);
  if (!cik || !cusip) return v.bad(res, 'Missing or invalid cik/cusip');
  if (limit == null) return v.bad(res, 'Invalid limit');

  try {
    const plan = await getPlan(req);
    const want = Math.min(limit, LIMITS[plan].quarters);
    const payload = await cached(`poshist2:${cik}:${cusip}:${want}`, TTL.HOUR_6, async () => {
      const sub = await getSubmissions(cik);
      const all = list13F(sub);
      const filings = all.slice(0, want).reverse(); // oldest -> newest
      /** @type {{ reportDate: string, snap: import('../_lib/positionDiff.js').Snap | null }[]} */
      const filed = await mapLimit(filings, 4, async (/** @type {any} */ f) => {
        const { positions } = await getFilingHoldings(cik, f);
        /** @type {any[]} */
        const match = positions.filter((/** @type {any} */ p) => p.cusip === cusip && !p.putCall);
        const snap = match.length
          ? {
              reportDate: f.reportDate,
              shares: match.reduce((/** @type {number} */ s, p) => s + p.shares, 0),
              value: match.reduce((/** @type {number} */ s, p) => s + p.value, 0),
              weight: match.reduce((/** @type {number} */ s, p) => s + p.weight, 0),
            }
          : null;
        return { reportDate: f.reportDate, snap };
      });
      return {
        cusip,
        quarters: buildTimeline(filed),
        loadedFilings: filings.length,
        totalFilings: all.length,
      };
    });
    res.setHeader('Cache-Control', 'private, no-store');
    res.status(200).json({ ...payload, plan, truncated: payload.totalFilings > payload.loadedFilings });
  } catch (/** @type {any} */ err) {
    res.status(502).json({ error: String(err?.message || err) });
  }
}
