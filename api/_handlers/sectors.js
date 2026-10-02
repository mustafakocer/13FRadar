import { loadSectorMap } from '../_lib/stockMeta.js';

// GET /api/sectors?symbols=AAPL,MSFT,...  (max 30)
// Returns { AAPL: 'Technology', ... } from the committed sector map (SEC's
// SIC code per filer, refreshed by the daily build). A symbol the map has
// never classified answers null: no quote provider is asked while a page
// opens (Yahoo used to be, for those).
export default async function handler(req, res) {
  const symbols = String(req.query.symbols || '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 30);
  if (!symbols.length) return res.status(400).json({ error: 'Missing symbols' });
  const known = loadSectorMap().bySymbol || {};
  const out = {};
  for (const sym of symbols) out[sym] = sym in known && known[sym] !== 'ETF' ? known[sym] : null;
  res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
  res.status(200).json(out);
}
