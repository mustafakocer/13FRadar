import { cached, TTL } from '../_lib/cache.js';
import { mapLimit } from '../_lib/yahooClient.js';
import { dailyCloses } from '../_lib/providers.js';
import { returnsFromSeries } from '../_lib/priceStore.js';
import { priceSnapshot } from '../_lib/priceSnapshot.js';

// One symbol's {price, ret1y, retYtd, ret1d}: from the close series (the
// nightly cache, then a live provider), else the nightly return file the
// build wrote (returns.json), else nulls.
async function symbolReturns(sym) {
  const prices = await dailyCloses(sym);
  if (prices?.length) return returnsFromSeries(sym, prices);
  const snap = priceSnapshot(sym);
  return { symbol: sym, price: snap?.price?.price ?? null, asOf: snap?.priceAsOf || null, ret1y: snap?.history?.ret1y ?? null, retYtd: snap?.history?.retYtd ?? null, ret1d: snap?.history?.ret1d ?? null };
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
    const rows = await mapLimit(symbols, 6, (sym) => cached(`ret:${sym}`, TTL.HOUR_1, () => symbolReturns(sym)));
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
