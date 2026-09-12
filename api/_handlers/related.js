import { createRequire } from 'node:module';

// GET /api/related/:cik → top-5 managers by holdings overlap (Jaccard on
// tickers), from the nightly precompute api/_data/related.json.
const require = createRequire(import.meta.url);
export default function handler(req, res) {
  const cik = String(req.query.cik || '').replace(/\D/g, '').padStart(10, '0');
  let table;
  try {
    table = require('../_data/related.json');
  } catch {
    return res.status(404).json({ error: 'related.json not built' });
  }
  res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
  const rows = table.related[cik];
  if (!rows) return res.status(404).json({ error: 'no related managers for this filer' });
  res.status(200).json({ cik, updatedAt: table.updatedAt, source: table.source, related: rows });
}
