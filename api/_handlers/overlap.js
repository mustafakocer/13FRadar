// @ts-check
import { cached, TTL } from '../_lib/cache.js';
import { getSubmissions, list13F, getFilingHoldings } from '../_lib/sec.js';
import { mapCusipsToTickers } from '../_lib/figi.js';
import { mapLimit } from '../_lib/yahooClient.js';
import { getPlan, LIMITS } from '../_lib/plan.js';
import { requireFlag } from '../_lib/flags.js';
import { computeOverlap } from '../_lib/overlap.js';
import * as v from '../_lib/validate.js';

// GET /api/overlap?ciks=0001067983,0001336528[,...]   2..5 funds
// Free plan: 2 funds. Pro: up to 5.
/** @param {any} req @param {any} res */
export default async function handler(req, res) {
  if (!requireFlag('overlap', res)) return;
  const raw = String(req.query.ciks || '').split(',').map((s) => s.trim()).filter(Boolean);
  const ciks = [...new Set(raw.map(v.cik))];
  if (ciks.some((c) => !c) || ciks.length < 2 || ciks.length > 5) {
    return v.bad(res, 'ciks must be 2..5 valid CIKs');
  }
  try {
    const plan = await getPlan(req);
    if (ciks.length > LIMITS[plan].compareFunds) {
      return res.status(402).json({ error: 'pro-required', limit: LIMITS[plan].compareFunds });
    }
    const key = `overlap:${[...ciks].sort().join(',')}`;
    const payload = await cached(key, TTL.HOUR_6, async () => {
      const funds = await mapLimit(ciks, 3, async (/** @type {string} */ cik) => {
        const sub = await getSubmissions(cik);
        const fl = list13F(sub);
        if (!fl.length) throw new Error(`No 13F filings for CIK ${cik}`);
        const cur = await getFilingHoldings(cik, fl[0]);
        let prev = null;
        if (fl[1]) {
          try {
            prev = await getFilingHoldings(cik, fl[1]);
          } catch {
            /* prev optional */
          }
        }
        return { cik, name: sub.name, reportDate: fl[0].reportDate, cur: cur.positions, prev: prev ? prev.positions : null };
      });
      const out = computeOverlap(/** @type {any} */ (funds));
      // resolve tickers for what we show
      const cusips = new Set();
      for (const r of out.shared) cusips.add(r.cusip);
      for (const list of Object.values(out.unique)) for (const r of list) cusips.add(r.cusip);
      for (const r of [...out.sharedBuys, ...out.sharedSells]) cusips.add(r.cusip);
      let tickers = /** @type {Record<string, string|null>} */ ({});
      try {
        tickers = /** @type {any} */ (await mapCusipsToTickers([...cusips].slice(0, 400)));
      } catch {
        /* tickers optional */
      }
      const fill = (/** @type {{cusip:string, ticker:string|null}} */ r) => ({ ...r, ticker: r.ticker || tickers[r.cusip] || null });
      return {
        ...out,
        shared: out.shared.map(fill),
        unique: Object.fromEntries(Object.entries(out.unique).map(([k, list]) => [k, list.map(fill)])),
        sharedBuys: out.sharedBuys.map(fill),
        sharedSells: out.sharedSells.map(fill),
      };
    });
    res.setHeader('Cache-Control', 'private, no-store');
    res.status(200).json({ ...payload, plan, maxFunds: LIMITS[plan].compareFunds });
  } catch (/** @type {any} */ err) {
    res.status(502).json({ error: String(err?.message || err) });
  }
}
