// Per-guru quarterly history, precomputed by scripts/build-guru-history.mjs
// into api/_data/guru-history.json (daily Action). Nothing here touches
// EDGAR at request time.
//
//   {
//     updatedAt, quarters: 40,
//     gurus: {
//       [cik]: {
//         name, quarters: [{ reportDate, filed, acc, aum, count, turnover, top10: [tickers] }],  // oldest → newest
//         positions: { [cusip]: { ticker, issuer, heldQuarters, firstSeen, series: [[reportDate, shares, value, weight], …] } }
//       }
//     }
//   }
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let cache;
export function historyTable() {
  if (cache === undefined) {
    try {
      // GURU_HISTORY_FILE lets tests point at a fixture
      cache = require(process.env.GURU_HISTORY_FILE || '../_data/guru-history.json');
    } catch {
      cache = null;
    }
  }
  return cache;
}

// Positions worth storing: anything that ranked in a quarter's top N by
// value at least once. The pages only ever show top holdings (time held on
// the top-10 table, guru × ticker pages, related managers), and the quant
// shops carry 10–20k names that would otherwise dominate the file.
export function topRankedCusips(positions, n) {
  const byDate = new Map();
  for (const [cusip, e] of Object.entries(positions)) {
    for (const [d, , v] of e.series) {
      let a = byDate.get(d);
      if (!a) byDate.set(d, (a = []));
      a.push([v, cusip]);
    }
  }
  const keep = new Set();
  for (const a of byDate.values()) {
    a.sort((x, y) => y[0] - x[0]);
    for (const [, c] of a.slice(0, n)) keep.add(c);
  }
  return keep;
}

export const guruHistory = (cik) => historyTable()?.gurus?.[String(cik).padStart(10, '0')] || null;

// "Time held": consecutive quarters up to and including the latest, as text.
// Capped at ">10 Years" (the precompute looks 40 quarters back).
export function timeHeldLabel(quarters, lang = 'en') {
  if (!quarters) return null;
  if (quarters >= 40) return lang === 'tr' ? '>10 Yıl' : '>10 Years';
  const years = quarters / 4;
  if (years < 1) return lang === 'tr' ? `${quarters} Çeyrek` : `${quarters} Q`;
  const y = Math.round(years * 10) / 10;
  return lang === 'tr' ? `${y} Yıl` : `${y} Year${y === 1 ? '' : 's'}`;
}

// Apply split adjustments to a historical share count so it is comparable
// with today's share count. splits: [{ date: 'YYYY-MM-DD', ratio: 4 }] (4 = 4-for-1).
export function splitAdjust(shares, reportDate, splits = []) {
  let factor = 1;
  for (const s of splits) if (s.date > reportDate) factor *= s.ratio;
  return shares * factor;
}
