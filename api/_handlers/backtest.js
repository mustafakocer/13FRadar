// @ts-check
import { cached, TTL } from '../_lib/cache.js';
import { getSubmissions, list13F, getFilingHoldings } from '../_lib/sec.js';
import { mapCusipsToTickers } from '../_lib/figi.js';
import { mapLimit } from '../_lib/yahooClient.js';
import { dailyCloses } from '../_lib/providers.js';
import { priceAt } from '../_lib/performance.js';
import { alignGroupSnapshots, runBacktest } from '../_lib/backtest.js';
import { requirePro } from '../_lib/auth.js';
import { requireFlag } from '../_lib/flags.js';
import * as v from '../_lib/validate.js';

// GET /api/backtest?ciks=a[,b..]&start=YYYY-MM-DD&weighting=aum|equal&top=25   (Pro)
// Rebalances at each filing's release date (quarter end + 45 days).
const MAX_QUARTERS = 24;
const MAX_SYMBOLS = 220;

/** @param {any} req @param {any} res */
export default async function handler(req, res) {
  if (!requireFlag('backtest', res)) return;
  if (!(await requirePro(req, res))) return;
  const ciks = [...new Set(String(req.query.ciks || '').split(',').map((s) => v.cik(s)?.padStart(10, '0')).filter(Boolean))];
  const start = v.isoDate(req.query.start);
  const weighting = /** @type {'aum'|'equal'|null} */ (v.oneOf(req.query.weighting, ['aum', 'equal'], 'aum'));
  const top = v.intIn(req.query.top, 5, 50, 25);
  if (!ciks.length || ciks.length > 5 || !start || !weighting || top == null) return v.bad(res, 'ciks (1..5), start, weighting, top');
  try {
    const key = `backtest:${[...ciks].sort().join(',')}:${start}:${weighting}:${top}`;
    const payload = await cached(key, TTL.HOUR_6, async () => {
      const funds = await mapLimit(ciks, 3, async (/** @type {string} */ cik) => {
        const sub = await getSubmissions(cik);
        const fl = list13F(sub).filter((f) => f.reportDate >= start).slice(0, MAX_QUARTERS).reverse();
        const snaps = [];
        for (const f of fl) {
          const h = /** @type {any} */ (await getFilingHoldings(cik, f));
          snaps.push({ reportDate: f.reportDate, aum: h.aum, positions: h.positions.filter((/** @type {any} */ p) => !p.putCall).sort((/** @type {any} */ a, /** @type {any} */ b) => b.value - a.value).slice(0, top).map((/** @type {any} */ p) => ({ cusip: p.cusip, ticker: /** @type {string|null} */ (null), weight: p.weight, value: p.value })) });
        }
        return { cik, name: sub.name, snaps };
      });
      const cusips = new Set();
      for (const f of funds) for (const s of f.snaps) for (const p of s.positions) cusips.add(p.cusip);
      const tickers = /** @type {Record<string, string|null>} */ (await mapCusipsToTickers([...cusips], { maxLive: 300 }).catch(() => ({})));
      for (const f of funds) for (const s of f.snaps) for (const p of s.positions) p.ticker = tickers[p.cusip] || null;
      const snapshots = alignGroupSnapshots(funds, weighting, top);
      const symbols = new Set(['SPY']);
      for (const s of snapshots) for (const p of s.positions) if (p.ticker) symbols.add(p.ticker);
      if (symbols.size > MAX_SYMBOLS) throw new Error(`too many symbols to price (${symbols.size}); lower top or shorten the period`);
      const series = new Map();
      await mapLimit([...symbols], 4, async (/** @type {string} */ sym) => {
        try {
          series.set(sym, await dailyCloses(sym));
        } catch {}
      });
      const px = (/** @type {string} */ sym, /** @type {string} */ date) => priceAt(series.get(sym), date);
      const result = runBacktest(snapshots, px, { endDate: new Date().toISOString().slice(0, 10), benchmark: 'SPY' });
      return {
        params: { ciks, start, weighting, top },
        funds: funds.map((f) => ({ cik: f.cik, name: f.name, filings: f.snaps.length })),
        priced: series.size,
        symbols: symbols.size,
        priceSource: process.env.FMP_API_KEY ? 'FMP' : process.env.TWELVEDATA_API_KEY ? 'Twelve Data' : 'Stooq',
        ...result,
      };
    });
    res.setHeader('Cache-Control', 'private, no-store');
    res.status(200).json(payload);
  } catch (/** @type {any} */ err) {
    res.status(502).json({ error: String(err?.message || err) });
  }
}
