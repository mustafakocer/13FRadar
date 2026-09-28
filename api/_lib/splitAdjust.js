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
