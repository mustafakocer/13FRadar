// Last-known price and identity for a symbol, from the files the nightly
// builds commit — the cache that is always there.
//
// The quote providers the stock page reads live (Yahoo, FMP, TwelveData,
// Stooq) all block or throttle a serverless region on a bad day, and a page
// whose status depends on them is a page that is down when they are. The
// daily build already prices every symbol the curated funds hold
// (api/_data/ticker-meta.json: close, 52-week range, volume, market cap,
// sector, name, as-of date) and stores their return columns
// (client/public/returns.json). Reading those back is a synchronous file
// read, so a stock page can always render a real, dated price and say it is
// dated — instead of a spinner and then a 502.
//
// The same files answer "is this a symbol we know at all": a page for a
// symbol none of our data has ever seen is a 404, a page whose live quote is
// merely unavailable is not.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const load = (rel, override) => {
  try {
    if (override) return JSON.parse(fs.readFileSync(path.resolve(override), 'utf8'));
    return require(rel);
  } catch {
    return null;
  }
};

let meta;
let returns;
let known;
const tickerMeta = () => (meta === undefined ? (meta = load('../_data/ticker-meta.json', process.env.TICKER_META_FILE) || {}) : meta);
const returnsTable = () => (returns === undefined ? (returns = load('../../client/public/returns.json')?.returns || {}) : returns);

// Every symbol any committed dataset carries, upper-cased. Built once per
// process; the files change only with a deploy.
function knownSymbols() {
  if (known) return known;
  known = new Set();
  const add = (t) => {
    if (t) known.add(String(t).toUpperCase());
  };
  for (const t of Object.keys(tickerMeta())) add(t);
  for (const t of Object.keys(returnsTable())) add(t);
  for (const t of Object.values(load('../_data/cusip-tickers.json') || {})) add(t);
  for (const r of load('../../client/public/stocks.json')?.rows || []) add(r.ticker);
  const gs = load('../_data/guru-stocks.json', process.env.GURU_STOCKS_FILE);
  for (const s of gs?.stocks || []) add(s.ticker);
  for (const o of gs?.options || []) add(o.ticker);
  return known;
}

export const knownSymbol = (ticker) => knownSymbols().has(String(ticker || '').toUpperCase());

// Test seam: the tables are memoised for the life of the process.
export const resetPriceSnapshotCache = () => {
  meta = undefined;
  returns = undefined;
  known = undefined;
};

const num = (x) => (Number.isFinite(x) ? x : null);

// The stock payload shape (see api/_handlers/stock.js) with only what the
// files know: a dated close, the 52-week range, volume, market cap, sector.
// Null when the symbol has never been priced by a build.
export function priceSnapshot(ticker) {
  const sym = String(ticker || '').toUpperCase();
  const m = tickerMeta()[sym];
  const r = returnsTable()[sym];
  if (!m && !r) return null;
  const price = num(m?.px);
  const ret1d = num(r?.ret1d);
  // yesterday's close backed out of the 1D return: the only "previous close"
  // the files can offer, and only when both numbers describe the same day
  const prevClose = price != null && ret1d != null && r?.asOf === m?.asOf ? price / (1 + ret1d / 100) : null;
  return {
    source: 'snapshot',
    priceStale: true,
    priceAsOf: m?.asOf || r?.asOf || null,
    price: {
      symbol: sym,
      name: m?.name || sym,
      currency: 'USD',
      price,
      change: price != null && prevClose != null ? price - prevClose : null,
      changePercent: price != null && prevClose != null ? ret1d : null,
      open: null,
      high: null,
      low: null,
      prevClose,
      volume: num(m?.vol),
      marketCap: num(m?.mcap),
      high52: num(m?.hi),
      low52: num(m?.lo),
    },
    valuation: {},
    fundamentals: {},
    trading: { avgVolume: num(m?.vol) },
    analyst: {},
    income: [],
    balance: [],
    cashflow: [],
    earnings: [],
    profile: { sector: m?.sector || null },
    history: r ? { ret1y: num(r.ret1y), retYtd: num(r.retYtd), ret1d } : null,
  };
}

// The payload for a symbol nothing can price right now: every field the page
// reads is present and null, so the rest of the page (ownership, FAQ, links)
// renders and the price block says the quote is unavailable.
export function priceUnavailable(ticker) {
  const sym = String(ticker || '').toUpperCase();
  return {
    source: 'none',
    priceStale: true,
    priceUnavailable: true,
    priceAsOf: null,
    price: {
      symbol: sym,
      name: sym,
      currency: 'USD',
      price: null,
      change: null,
      changePercent: null,
      open: null,
      high: null,
      low: null,
      prevClose: null,
      volume: null,
      marketCap: null,
      high52: null,
      low52: null,
    },
    valuation: {},
    fundamentals: {},
    trading: {},
    analyst: {},
    income: [],
    balance: [],
    cashflow: [],
    earnings: [],
    profile: {},
  };
}
