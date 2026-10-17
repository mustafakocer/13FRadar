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

// Which splits a stored position's share counts already carry. The nightly
// build keeps the quarter rows it read on earlier nights, so "is this
// position split-adjusted?" is not a yes/no: a row adjusted in March does not
// know about a 4-for-1 in July (CRWD 2026-07-02). Each position records the
// splits its rows carry (`splitsApplied`, one key per split) and every run
// applies only what is missing — and takes back a split splits.json no longer
// lists — so running the build twice never adjusts a row twice.
export const splitKey = (s) => `${s.date}:${s.ratio}`;
const parseSplitKey = (k) => {
  const i = String(k).indexOf(':');
  return { date: String(k).slice(0, i), ratio: Number(String(k).slice(i + 1)) };
};

// series: [[reportDate, shares, value, weight], …]; applied: the keys the
// stored rows carry (null for a position never adjusted); splits: the
// ticker's current splits.json entries; fresh: report dates read this run
// (raw shares, no split applied yet). Returns the rows in today's shares and
// the keys they now carry. Spin-off price factors are never applied.
export function reconcileSplits(series, applied, splits = [], fresh = new Set()) {
  const want = (splits || []).filter((s) => isShareSplit(s.ratio));
  const wantKeys = new Set(want.map(splitKey));
  const had = new Set(applied || []);
  const missing = want.filter((s) => !had.has(splitKey(s)));
  const stale = [...had].filter((k) => !wantKeys.has(k)).map(parseSplitKey).filter((s) => s.ratio > 0);
  const out = (series || []).map((r) => {
    const [d, sh, ...rest] = r;
    let f = 1;
    if (fresh.has(d)) {
      for (const s of want) if (s.date > d) f *= s.ratio;
    } else {
      for (const s of missing) if (s.date > d) f *= s.ratio;
      for (const s of stale) if (s.date > d) f /= s.ratio;
    }
    return f === 1 ? r : [d, Math.round(sh * f), ...rest];
  });
  return { series: out, applied: [...wantKeys].sort() };
}

// Which of a ticker's adjustment factors a stored row already carries, read
// off the row itself: value / shares is the price per stored share, `close`
// the report date's close adjusted for every factor (the price cache), so
// their ratio is the product of the factors the row is missing. Returns the
// product of the subset that explains it, or null when the price cannot
// decide — nothing within 3%, or two subsets within 1% of each other.
// `after`: the factors dated after the row, [{ date, ratio }].
export function factorsCarried(row, after, close) {
  const [, sh, v] = row || [];
  if (!(close > 0) || !(sh > 0) || !(v > 0) || !after?.length || after.length > 8) return null;
  const all = after.reduce((f, s) => f * s.ratio, 1);
  const carried = all / (v / sh / close);
  const cands = [];
  for (let m = 0; m < 1 << after.length; m++) {
    let p = 1;
    for (let i = 0; i < after.length; i++) if ((m >> i) & 1) p *= after[i].ratio;
    cands.push({ d: Math.abs(Math.log(carried / p)), p });
  }
  cands.sort((a, b) => a.d - b.d);
  const best = cands[0];
  const next = cands.find((c) => Math.abs(Math.log(c.p / best.p)) > 1e-9);
  if (best.d > 0.03) return null;
  if (next && next.d - best.d < 0.01) return null;
  return best.p;
}
