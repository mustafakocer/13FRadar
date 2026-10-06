import { createRequire } from 'node:module';
import { guruHistory } from '../_lib/history.js';
import { tickerOfPosition } from '../_lib/historyResolve.js';
import { closeOn } from '../_lib/valueUnits.js';
import { readSeries } from '../_lib/priceStore.js';
import { guruPerformance } from '../_lib/performance.js';
import { GURUS } from '../_lib/gurus.js';

// GET /api/guru-performance/:cik  → { cik, name, asOf, horizons, periods }
// GET /api/guru-performance       → { asOf, rows: [{ cik, name, y1, y3, y5, y10, spy1 }] }
//                                   every curated guru with a figure, best 1Y first
//
// From the nightly api/_data/guru-performance.json
// (scripts/build-guru-performance.mjs); a guru missing from the file (the
// history was rebuilt after it) is computed on the spot from the history
// and the price cache. Public, cached a quarter of a day.
const require = createRequire(import.meta.url);
let file;
function table() {
  if (file === undefined) {
    try {
      file = require('../_data/guru-performance.json');
    } catch {
      file = null;
    }
  }
  return file;
}

const live = new Map();
function compute(cik) {
  if (live.has(cik)) return live.get(cik);
  const g = guruHistory(cik);
  const asOf = readSeries('SPY')?.prices?.at(-1)?.date || null;
  const out = g && asOf ? { name: g.name, ...guruPerformance(g, { priceAt: closeOn, asOf, tickerOf: tickerOfPosition }) } : null;
  live.set(cik, out);
  return out;
}

export default function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=604800');
  const t = table();
  const cik = String(req.query.cik || '').replace(/\D/g, '');
  if (cik) {
    const id = cik.padStart(10, '0');
    const stored = t?.byCik?.[id];
    const p = stored ? { ...stored, asOf: stored.asOf || t.asOf } : compute(id);
    if (!p) return res.status(404).json({ error: 'No performance for this filer' });
    return res.status(200).json({ cik: id, name: p.name, asOf: p.asOf, current: p.current !== false, horizons: p.horizons, periods: p.periods });
  }
  const rows = [];
  for (const g of GURUS) {
    const id = String(g.cik).padStart(10, '0');
    const p = t?.byCik?.[id];
    // the list ranks funds still filing; a closed book's year is not this year
    if (!p?.horizons?.y1 || p.horizons.y1.port == null || p.current === false || g.activeTo) continue;
    rows.push({ cik: id, name: g.name, y1: p.horizons.y1.port, spy1: p.horizons.y1.spy, y3: p.horizons.y3.port, y5: p.horizons.y5.port, y10: p.horizons.y10.port, coverage: p.horizons.y1.coverage });
  }
  rows.sort((a, b) => b.y1 - a.y1);
  res.status(200).json({ asOf: t?.asOf || null, rows });
}
