import { cached, TTL } from './_lib/cache.js';
import { yahooQuoteSummary, mapLimit } from './_lib/yahooClient.js';

// GET /api/sectors?symbols=AAPL,MSFT,...  (max 30)
// Returns { AAPL: 'Technology', ... } — sectors change rarely, cache 7 days.
export default async function handler(req, res) {
  const symbols = String(req.query.symbols || '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 30);
  if (!symbols.length) return res.status(400).json({ error: 'Missing symbols' });

  try {
    const rows = await mapLimit(symbols, 4, (sym) =>
      cached(`sector:${sym}`, TTL.DAY_7, async () => {
        const r = await yahooQuoteSummary(sym, ['assetProfile']);
        return r?.assetProfile?.sector || null;
      })
    );
    const out = {};
    rows.forEach((sector, i) => {
      out[symbols[i]] = sector ?? null;
    });
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
    res.status(200).json(out);
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
}
