import { cached, TTL } from '../_lib/cache.js';
import { yahooChartReturns, mapLimit } from '../_lib/yahooClient.js';
import { returnsFromSeries } from '../_lib/stooq.js';
import { dailyCloses } from '../_lib/providers.js';

async function symbolReturns(sym) {
  try {
    return await yahooChartReturns(sym);
  } catch {
    const prices = await dailyCloses(sym);
    return returnsFromSeries(sym, prices);
  }
}

// GET /api/returns?symbols=AAPL,MSFT,...  (max 60)
// Returns { AAPL: {price, ret1y, retYtd, ret1d}, ... }
export default async function handler(req, res) {
  const symbols = String(req.query.symbols || '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 60);
  if (!symbols.length) return res.status(400).json({ error: 'Missing symbols' });

  try {
    const rows = await mapLimit(symbols, 6, (sym) =>
      cached(`ret:${sym}`, TTL.HOUR_1, () => symbolReturns(sym))
    );
    const out = {};
    rows.forEach((r, i) => {
      if (r) out[symbols[i]] = r;
    });
    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=7200');
    res.status(200).json(out);
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
}
