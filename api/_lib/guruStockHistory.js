// Ownership of one security across quarters, pivoted out of the per-guru
// history that scripts/build-guru-history.mjs already writes.
//
// The history is stored the way it is collected — by fund, then by position —
// which answers "what has this fund held". The question a stock page asks is
// the transpose: how many of them owned this name each quarter, and what was
// it worth between them. Pivoting costs one pass over a file that is already
// in memory, so it happens here rather than in another build artefact.
//
// Coverage is the history's, not the whole panel's: a fund whose book is too
// wide to backfill (see popular.js) contributes nothing, and only positions
// that ranked in some quarter's top N are stored. The trend therefore
// describes the funds it can see, and says how many those were.
import { historyTable } from './history.js';

let cache;
let builtFrom;

function build() {
  const table = historyTable();
  if (!table) return null;
  const byCusip = new Map();
  const gurus = Object.entries(table.gurus || {});
  for (const [cik, guru] of gurus) {
    for (const [cusip, pos] of Object.entries(guru.positions || {})) {
      let entry = byCusip.get(cusip);
      if (!entry) {
        entry = { cusip, ticker: pos.ticker || null, issuer: pos.issuer || null, quarters: new Map() };
        byCusip.set(cusip, entry);
      }
      // a ticker resolved for one fund's copy of the position serves them all
      if (!entry.ticker && pos.ticker) entry.ticker = pos.ticker;
      if (!entry.issuer && pos.issuer) entry.issuer = pos.issuer;
      for (const [reportDate, shares, value, weight] of pos.series || []) {
        if (!reportDate) continue;
        const q = entry.quarters.get(reportDate) || { reportDate, holders: 0, value: 0, weight: 0, ciks: [] };
        q.holders++;
        q.value += Number(value) || 0;
        q.weight += Number(weight) || 0;
        q.ciks.push(cik);
        entry.quarters.set(reportDate, q);
      }
    }
  }

  const out = new Map();
  for (const [cusip, entry] of byCusip) {
    const quarters = [...entry.quarters.values()]
      .sort((a, b) => (a.reportDate < b.reportDate ? -1 : 1))
      .map((q) => ({
        reportDate: q.reportDate,
        holders: q.holders,
        value: Math.round(q.value),
        avgWeight: Number((q.weight / q.holders).toFixed(2)),
      }));
    out.set(cusip, { cusip, ticker: entry.ticker, issuer: entry.issuer, quarters });
  }
  return { funds: gurus.length, byCusip: out };
}

function table() {
  const source = historyTable();
  // rebuilt only when the underlying history file changes identity
  if (cache && builtFrom === source) return cache;
  builtFrom = source;
  cache = build();
  return cache;
}

export const resetGuruStockHistoryCache = () => {
  cache = undefined;
  builtFrom = undefined;
};

const upper = (s) => String(s || '').trim().toUpperCase();

// Quarterly ownership for one security, oldest quarter first.
//   { funds, quarters: [{ reportDate, holders, value, avgWeight }] }
export function ownershipTrend({ cusip, ticker } = {}, { quarters = 40 } = {}) {
  const t = table();
  if (!t) return null;
  const cu = upper(cusip);
  let entry = cu ? t.byCusip.get(cu) : null;
  if (!entry && ticker) {
    const sym = upper(ticker);
    for (const e of t.byCusip.values()) {
      if (upper(e.ticker) === sym) {
        entry = e;
        break;
      }
    }
  }
  if (!entry?.quarters?.length) return null;
  return {
    funds: t.funds,
    cusip: entry.cusip,
    ticker: entry.ticker,
    quarters: entry.quarters.slice(-quarters),
  };
}

// The trend cut to a window a reader picks: 1Y is four quarters, 5Y twenty,
// 10Y forty. "All" is whatever the history holds.
export const TREND_RANGES = { '1y': 4, '5y': 20, '10y': 40, all: Infinity };

export function trendRange(trend, range = 'all') {
  if (!trend?.quarters?.length) return null;
  const n = TREND_RANGES[range] ?? Infinity;
  return { ...trend, range, quarters: Number.isFinite(n) ? trend.quarters.slice(-n) : trend.quarters };
}
