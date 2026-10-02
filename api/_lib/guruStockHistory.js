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
//
// One count per quarter, the same one the stock page's header states: the
// consensus panel's funds (api/_lib/gurus.js consensusPanel — the wide books
// such as Citadel, Renaissance or Capital Research are out, as they are out
// of every consensus number), and for the newest quarter the consensus
// table's own row (`current`), because the history keeps only each fund's
// top 100 lines and would miss a holder the full filing has. TSM showed
// "26 gurus" over a table saying 34 for the same quarter: the table counted
// nine wide books the header leaves out.
import { historyTable } from './history.js';
import { consensusPanel } from './gurus.js';

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
        const q = entry.quarters.get(reportDate) || { reportDate, books: [] };
        q.books.push([cik, Number(value) || 0, Number(weight) || 0]);
        entry.quarters.set(reportDate, q);
      }
    }
  }

  const out = new Map();
  for (const [cusip, entry] of byCusip) {
    const quarters = [...entry.quarters.values()].sort((a, b) => (a.reportDate < b.reportDate ? -1 : 1));
    out.set(cusip, { cusip, ticker: entry.ticker, issuer: entry.issuer, quarters });
  }
  return { ciks: new Set(gurus.map(([cik]) => cik)), byCusip: out };
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

const panelMemo = new Map();
const panelCiks = (reportDate) => {
  if (!panelMemo.has(reportDate)) panelMemo.set(reportDate, new Set(consensusPanel(reportDate).map((g) => g.cik)));
  return panelMemo.get(reportDate);
};

// One quarter's line from the panel's books.
function panelQuarter(q, panelOf) {
  const inPanel = panelOf(q.reportDate);
  const books = q.books.filter(([cik]) => inPanel.has(cik));
  if (!books.length) return null;
  const value = books.reduce((s, b) => s + b[1], 0);
  const weight = books.reduce((s, b) => s + b[2], 0);
  return { reportDate: q.reportDate, holders: books.length, value: Math.round(value), avgWeight: Number((weight / books.length).toFixed(2)) };
}

// The quarter line the stock page's header states, from the consensus
// table's row (api/_data/guru-stocks.json) — the single source of "how many
// gurus hold it and for how much" for the newest quarter.
export const currentOwnership = (row, reportDate) =>
  row && reportDate ? { reportDate, holders: row.holderCount, value: Math.round(row.totalValue), avgWeight: Number(Number(row.avgWeight || 0).toFixed(2)) } : null;

// Quarterly ownership for one security, oldest quarter first.
//   { funds, quarters: [{ reportDate, holders, value, avgWeight }] }
// funds: the panel funds the history covers. current: currentOwnership() of
// the newest quarter, which replaces (or adds) that quarter's line.
export function ownershipTrend({ cusip, ticker } = {}, { quarters = 40, current = null, panelOf = panelCiks } = {}) {
  const t = table();
  if (!t) return current ? { funds: 0, cusip: upper(cusip) || null, ticker: ticker || null, quarters: [current] } : null;
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
  let lines = (entry?.quarters || []).map((q) => panelQuarter(q, panelOf)).filter(Boolean);
  if (current) lines = [...lines.filter((q) => q.reportDate !== current.reportDate && q.reportDate < current.reportDate), current];
  if (!lines.length) return null;
  const newest = lines.at(-1).reportDate;
  return {
    funds: [...panelOf(newest)].filter((cik) => t.ciks.has(cik)).length,
    cusip: entry?.cusip || upper(cusip) || null,
    ticker: entry?.ticker || ticker || null,
    quarters: lines.slice(-quarters),
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
