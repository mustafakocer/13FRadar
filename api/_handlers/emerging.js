import { createRequire } from 'node:module';
import { filerPath } from '../_lib/slugs.js';

// GET /api/emerging — "emerging managers": 13F AUM between $100M and $1B and
// top-10 concentration ≥ 50%. The third criterion (≥40% of value in stocks
// under $5B market cap) needs a per-position market-cap field that no data
// source in the repo provides yet:
//   TODO(schema ready): universe.json rows carry `smallCapShare` (0–100, %
//   of value in <$5B market-cap names) once scripts/build-universe.mjs can
//   join a market-cap table; until then it is null and the page says so.
const require = createRequire(import.meta.url);

export default function handler(req, res) {
  let universe;
  try {
    universe = require('../../client/public/universe.json');
  } catch {
    return res.status(503).json({ error: 'universe not built' });
  }
  const rows = universe.rows
    .filter((r) => r.aum >= 100e6 && r.aum <= 1e9 && r.top10 >= 50)
    .map((r) => ({ cik: r.cik, name: r.name, filed: r.filed, aum: r.aum, positions: r.positions, top10: r.top10, smallCapShare: r.smallCapShare ?? null, path: filerPath(r.cik) }))
    .sort((a, b) => b.top10 - a.top10 || b.aum - a.aum);
  res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
  res.status(200).json({
    updatedAt: universe.updatedAt,
    criteria: { aumMin: 100e6, aumMax: 1e9, top10Min: 50, smallCapMin: 40, smallCapAvailable: rows.some((r) => r.smallCapShare != null) },
    total: rows.length,
    rows: rows.slice(0, 300),
  });
}
