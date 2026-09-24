import { cached, TTL } from '../_lib/cache.js';
import { requirePro } from '../_lib/auth.js';
import { getSubmissions, list13F, getEffectiveHoldings } from '../_lib/sec.js';
import { mapCusipsToTickers } from '../_lib/figi.js';
import { mapLimit } from '../_lib/yahooClient.js';
import { dailyCloses } from '../_lib/providers.js';
import { simulate } from '../_lib/backtest.js';

// GET /api/backtest/:cik?quarters=8&top=15 — the copy-the-13F backtest
// (experimental, Pro). The arithmetic is in _lib/backtest.js; this fetches
// the filings, resolves tickers and reads the close series — the nightly
// price cache first, a live provider for what it lacks (dailyCloses).
// `coverage` says how much of the filed weight was simulated and `skipped`
// names the positions that were not; without an SPY series the benchmark
// is null rather than a flat line.
export default async function handler(req, res) {
  if (!(await requirePro(req, res))) return;
  const cik = String(req.query.cik || '').replace(/\D/g, '');
  const quarters = Math.min(Number(req.query.quarters) || 8, 12);
  const topN = Math.min(Number(req.query.top) || 15, 25);
  if (!cik) return res.status(400).json({ error: 'Missing CIK' });

  try {
    const data = await cached(`backtest:${cik}:${quarters}:${topN}`, TTL.HOUR_6, async () => {
      const sub = await getSubmissions(cik);
      const filings = list13F(sub).slice(0, quarters + 1).reverse(); // oldest -> newest
      if (filings.length < 2) return { points: [], error: 'not-enough-filings', skipped: [], coverage: null, benchmark: null };

      const snapshots = await mapLimit(filings, 4, async (f) => {
        const { positions } = await getEffectiveHoldings(cik, f);
        return { f, top: positions.filter((p) => !p.putCall).slice(0, topN) };
      });
      const valid = snapshots.filter(Boolean);

      const cusips = [...new Set(valid.flatMap((s) => s.top.map((p) => p.cusip)))].slice(0, 150);
      const tickers = await mapCusipsToTickers(cusips);
      const uniq = [...new Set(Object.values(tickers).filter(Boolean))];

      const startDate = valid[0].f.reportDate;
      const priceSeries = {};
      await mapLimit([...uniq, 'SPY'], 6, async (sym) => {
        const all = await dailyCloses(sym);
        priceSeries[sym] = all ? all.filter((p) => p.date >= startDate) : null;
      });

      return simulate({ snapshots: valid, tickers, priceSeries, topN });
    });
    res.status(200).json(data);
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
}
