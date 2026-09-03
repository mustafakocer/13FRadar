// @ts-check
import { cached, TTL } from '../_lib/cache.js';
import { getSubmissions, list13F, getFilingHoldings } from '../_lib/sec.js';
import { mapCusipsToTickers } from '../_lib/figi.js';
import { mapLimit } from '../_lib/yahooClient.js';
import { getPlan, LIMITS } from '../_lib/plan.js';
import { requireFlag } from '../_lib/flags.js';
import { combinePortfolio } from '../_lib/groupPortfolio.js';
import * as v from '../_lib/validate.js';

// GET /api/group-portfolio?ciks=a,b,c&weighting=aum|equal
// Combined portfolio of the given funds (latest filing each). Member cap by plan.
/** @param {any} req @param {any} res */
export default async function handler(req, res) {
  if (!requireFlag('watchlists', res)) return;
  const ciks = [...new Set(String(req.query.ciks || '').split(',').map((s) => v.cik(s)?.padStart(10, '0')).filter(Boolean))];
  const weighting = /** @type {'aum'|'equal'|null} */ (v.oneOf(req.query.weighting, ['aum', 'equal'], 'aum'));
  if (!ciks.length || ciks.length > 20 || !weighting) return v.bad(res, 'ciks (1..20) and weighting=aum|equal required');
  try {
    const plan = await getPlan(req);
    if (ciks.length > LIMITS[plan].groupMembers) return res.status(402).json({ error: 'member-limit', limit: LIMITS[plan].groupMembers });
    const payload = await cached(`group:${weighting}:${[...ciks].sort().join(',')}`, TTL.HOUR_6, async () => {
      const funds = await mapLimit(ciks, 3, async (/** @type {string} */ cik) => {
        const sub = await getSubmissions(cik);
        const fl = list13F(sub);
        if (!fl.length) return null;
        const cur = await getFilingHoldings(cik, fl[0]);
        let prev = null;
        if (fl[1]) {
          try {
            prev = (await getFilingHoldings(cik, fl[1])).positions;
          } catch {}
        }
        return { cik, name: sub.name, reportDate: fl[0].reportDate, aum: cur.aum, positions: cur.positions, prev };
      });
      const out = combinePortfolio(/** @type {any} */ (funds.filter(Boolean)), weighting, { top: 100 });
      const cusips = new Set(out.positions.map((p) => p.cusip));
      for (const k of /** @type {const} */ (['NEW', 'ADD', 'REDUCE', 'EXIT'])) for (const r of out.trades[k]) cusips.add(r.cusip);
      let tickers = /** @type {Record<string, string|null>} */ ({});
      try {
        tickers = /** @type {any} */ (await mapCusipsToTickers([...cusips].slice(0, 300)));
      } catch {}
      const fill = (/** @type {any} */ r) => ({ ...r, ticker: r.ticker || tickers[r.cusip] || null });
      return {
        ...out,
        positions: out.positions.map(fill),
        trades: Object.fromEntries(Object.entries(out.trades).map(([k, list]) => [k, list.map(fill)])),
      };
    });
    res.setHeader('Cache-Control', 'private, no-store');
    res.status(200).json({ ...payload, plan });
  } catch (/** @type {any} */ err) {
    res.status(502).json({ error: String(err?.message || err) });
  }
}
