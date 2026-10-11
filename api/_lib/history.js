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

// "Time held" labels: one implementation shared with the client bundle.
export { timeHeldLabel, reachesDataStart } from '../../client/src/lib/timeHeld.js';

// Whether a splits.json ratio changes the share count. The table comes from
// Twelve Data's adjustment factors, which also carry spin-offs (GE 1.253,
// MMM 1.196, MIDD 1.243): those adjust the price, but a holder keeps the same
// number of shares, so multiplying a share count by one invents a sale. A
// real split is a small whole-number ratio (2, 25, 3:2 = 1.5, 1-for-15).
export function isShareSplit(ratio) {
  if (!(ratio > 0) || ratio === 1) return false;
  const x = ratio >= 1 ? ratio : 1 / ratio;
  for (let k = 1; k <= 10; k++) if (Math.abs(x * k - Math.round(x * k)) < 1e-6 * x * k) return true;
  return false;
}

// Apply split adjustments to a historical share count so it is comparable
// with today's share count — or, with `until`, with the count on that date.
// splits: [{ date: 'YYYY-MM-DD', ratio: 4 }] (4 = 4-for-1).
export function splitAdjust(shares, reportDate, splits = [], until = null) {
  let factor = 1;
  for (const s of splits) if (s.date > reportDate && (!until || s.date <= until) && isShareSplit(s.ratio)) factor *= s.ratio;
  return shares * factor;
}
