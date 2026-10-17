// Share splits, for comparing a price from the past with a price today.
//
// A Form 4 price is the price on the day of the trade. After a 4-for-1 split
// (CrowdStrike, July 2026) that price is four times today's for the same
// holding, so "return since the insider bought" read −75% on every pre-split
// CRWD buy, and the price-unit check (insiderOutcome.priceMismatch) took the
// split-adjusted daily closes for a currency problem. Divide the old price by
// every split after the trade and both comparisons are like for like.
//
// splits: { TICKER: [{ date: 'YYYY-MM-DD', ratio: 4 }] } — api/_data/splits.json,
// built nightly by scripts/build-splits.mjs.
import { createRequire } from 'node:module';
import { tickerFor } from './securityMaster.js';
import { splitAdjust } from './history.js';

const require = createRequire(import.meta.url);
let loaded = null;
export function loadSplits() {
  if (loaded) return loaded;
  try {
    loaded = require('../_data/splits.json').byTicker || {};
  } catch {
    loaded = {};
  }
  return loaded;
}

// Product of the ratios of splits strictly after `day` (1 when none).
export function splitFactor(ticker, day, splits = loadSplits()) {
  let f = 1;
  for (const s of splits?.[ticker] || []) if (s?.date > day && s.ratio > 0) f *= s.ratio;
  return f;
}

// The line's price in today's shares.
export const adjustedPrice = (r, splits) => (r?.p > 0 ? r.p / splitFactor(r.t, r.d, splits) : r?.p ?? null);

// Percent change from the trade to `current`, in today's shares; null when
// either price is missing or the form's price unit is unverified (`pu`).
export function sinceTrade(r, current, splits) {
  if (r?.pu || !(current > 0)) return null;
  const base = adjustedPrice(r, splits);
  return base > 0 ? ((current - base) / base) * 100 : null;
}

// The previous quarter's book in the current quarter's shares. A 25-for-1
// split between the two reports (BKNG, 2026-04) otherwise reads as every
// holder adding 2,400% — the quarter's largest "net buy" — and a reduce on
// top of a split as an add. Only share counts move; values are dollars and
// already comparable. Splits after the current report date are left out:
// both books are in pre-split shares then.
export function splitAdjustPrev(prev, prevDate, curDate, { tickerOf = tickerFor, splits = loadSplits() } = {}) {
  if (!prev?.positions?.length || !prevDate || !curDate) return prev;
  let touched = false;
  const positions = prev.positions.map((p) => {
    const t = tickerOf(p.cusip);
    const sp = t ? splits[t] : null;
    if (!sp?.length || !(p.shares > 0)) return p;
    const shares = Math.round(splitAdjust(p.shares, prevDate, sp, curDate));
    if (shares === p.shares) return p;
    touched = true;
    return { ...p, shares };
  });
  return touched ? { ...prev, positions } : prev;
}
