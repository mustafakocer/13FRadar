// Share splits the split table does not list, read off the filings.
//
// api/_data/splits.json is the table every share count is adjusted with. It
// has one source, and when that source stops answering (Twelve Data's /splits
// left the free plan in October 2026) a split after that day is simply not in
// it: SOXX and ITA, both 3-for-1, were the first two. The next 13F then shows
// three times the shares, and every reader of the table takes it for a
// purchase — a "+200%" add, the quarter's largest "net buy", an estimated
// purchase price a third too high.
//
// The evidence is already on file. A 13F row implies a price (value ÷ shares,
// in the shares of the report date). The price archive is split-adjusted by
// its provider on the day it is fetched, so its close for that date is in
// today's shares. Their ratio is the product of every split after the report
// date. Divide by the splits the table knows and what is left — the residual —
// is 1 for almost every row. A residual that sits on a split ratio (3.00) for
// the holders of a ticker, and steps back to 1 at a later quarter (or has not
// yet: the split is after the newest report), is a split the table lacks.
//
// Conservative on purpose — a wrong split is worse than a missing one:
//   · only the ratios splits come in (RATIOS), within TOL of them;
//   · the residual is the median over the ticker's holders at that quarter;
//   · one holder alone has to sit within TOL_SINGLE of the ratio (a warrant
//     at 2.05 is not a 2-for-1), several have to agree with their median;
//   · a split no later quarter has confirmed yet is only read off the newest
//     quarter of the whole table (the split is after the latest reports) —
//     a position last seen years ago proves nothing about today;
//   · a ticker whose residuals do not form a clean chain (a wrong series
//     under the ticker: CTVA sits at 6.67 in every quarter) infers nothing
//     from the first row that does not fit;
//   · one split a ticker: two would be a quarter whose close is wrong in the
//     archive (a ×6 followed by a ÷6), not two splits — nothing is inferred;
//   · the table always wins: a split it lists is part of the expectation, so
//     nothing is inferred on top of it, and when it learns the split the
//     inference goes away by itself.
//
// The date of an inferred split is the day after the last report still in old
// shares: the true day is somewhere before the next report, and every reader
// here compares quarter ends, for which that is exact. `evidence.until` is
// the first report in new shares (null while none exists).
//
// Pure: the history table, the split table and a close lookup go in.
import { splitKey, isShareSplit } from './history.js';

export const RATIOS = [1.5, 2, 3, 4, 5, 6, 7, 8, 10, 15, 20, 25, 30, 40, 50];
export const TOL = 0.03;
export const TOL_SINGLE = 0.01;
export const SOURCE = 'inferred-13f';

const near = (x, y, tol = TOL) => x > 0 && y > 0 && Math.abs(Math.log(x / y)) <= Math.log(1 + tol);
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const dayAfter = (iso) => new Date(Date.parse(`${iso}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

// The split ratio `x` sits on (3, or 0.1 for a 1-for-10), or null.
export function splitRatio(x, tol = TOL) {
  if (!(x > 0)) return null;
  for (const r of RATIOS) {
    if (near(x, r, tol)) return r;
    if (near(x, 1 / r, tol)) return 1 / r;
  }
  return null;
}

const parseKey = (k) => {
  const i = String(k).indexOf(':');
  return { date: String(k).slice(0, i), ratio: Number(String(k).slice(i + 1)) };
};

// One stored row's residual: (value ÷ shares as filed) ÷ adjusted close ÷ the
// table's factors after the row. `applied` are the split keys the stored row
// already carries (history.js reconcileSplits) — taken back out, so the
// answer does not depend on what an earlier night applied, inferred splits
// included.
export function rowResidual(row, { applied = [], table = [], close }) {
  const [d, sh, v] = row || [];
  if (!(sh > 0) || !(v > 0) || !(close > 0)) return null;
  let carried = 1;
  for (const k of applied || []) {
    const s = parseKey(k);
    if (s.date > d && s.ratio > 0) carried *= s.ratio;
  }
  let known = 1;
  for (const s of table || []) if (s?.date > d && s.ratio > 0) known *= s.ratio;
  return (v / (sh / carried) / close) / known;
}

// history: guru-history.json; table: splits.json byTicker; closeOf(ticker, date)
// → { byTicker: { T: [{ date, ratio, source, evidence }] }, rejected: [...] }
export function inferSplits(history, { table = {}, closeOf } = {}) {
  // ticker → date → residuals over the holders
  const by = new Map();
  for (const g of Object.values(history?.gurus || {})) {
    for (const e of Object.values(g.positions || {})) {
      const t = e.ticker;
      if (!t) continue;
      for (const row of e.series || []) {
        const close = closeOf(t, row[0]);
        const res = rowResidual(row, { applied: e.splitsApplied, table: table[t], close });
        if (res == null) continue;
        let dates = by.get(t);
        if (!dates) by.set(t, (dates = new Map()));
        const a = dates.get(row[0]);
        if (a) a.push(res);
        else dates.set(row[0], [res]);
      }
    }
  }
  let newest = '';
  for (const dates of by.values()) for (const d of dates.keys()) if (d > newest) newest = d;
  const byTicker = {};
  const rejected = [];
  for (const [t, dates] of by) {
    const obs = [...dates.entries()].map(([date, a]) => ({ date, m: median(a), n: a.length, agree: a.filter((x) => near(x, median(a))).length })).sort((a, b) => (a.date < b.date ? 1 : -1)); // newest first
    const out = [];
    let expect = 1; // the residual every older row should show
    let until = null;
    for (let i = 0; i < obs.length; i++) {
      const o = obs[i];
      if (near(o.m, expect)) {
        until = o.date;
        continue;
      }
      const step = splitRatio(o.m / expect);
      // one holder: exactly on the ratio; several: most agree with the median
      const enough = o.n === 1 ? splitRatio(o.m / expect, TOL_SINGLE) != null : o.agree >= 2 && o.agree > o.n / 2;
      // not yet confirmed by a later quarter: only at the table's newest quarter
      const timely = until != null || o.date === newest;
      if (step == null || !enough || !timely) {
        if (Math.abs(Math.log(o.m / expect)) > Math.log(1.25)) rejected.push({ ticker: t, date: o.date, residual: Number((o.m / expect).toPrecision(4)), holders: o.n, why: step == null ? 'not a split ratio' : !enough ? 'too few holders agree' : 'unconfirmed and not the newest quarter' });
        break; // nothing older can be read against an unknown expectation
      }
      out.push({
        date: dayAfter(o.date),
        ratio: step,
        source: SOURCE,
        evidence: { from: o.date, until, holders: o.n, residual: Number((o.m / expect).toPrecision(5)) },
      });
      expect *= step;
      until = o.date;
    }
    if (out.length === 1) byTicker[t] = out;
    else if (out.length > 1) rejected.push({ ticker: t, date: out[0].evidence.from, residual: out[0].evidence.residual, holders: out[0].evidence.holders, why: `${out.length} steps in one series: a wrong close, not a split` });
  }
  return { byTicker, rejected: rejected.sort((a, b) => a.ticker.localeCompare(b.ticker)) };
}

// The table and the inferred splits as one table. The table wins: an
// inferred split is left out when the table lists a share split of the same
// ratio after the evidence starts (it learnt the real one before the
// inference was rebuilt).
export function mergeSplitTables(table = {}, inferred = {}) {
  const out = { ...table };
  for (const [t, list] of Object.entries(inferred || {})) {
    const have = table[t] || [];
    const add = (list || []).filter((s) => s?.ratio > 0 && s.date && !have.some((h) => isShareSplit(h.ratio) && near(h.ratio, s.ratio, 0.001) && h.date > (s.evidence?.from || s.date)));
    if (add.length) out[t] = [...have, ...add].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }
  return out;
}

export { splitKey };
