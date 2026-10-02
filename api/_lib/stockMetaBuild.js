// The enrichment pass over the per-security table: sector, market cap and
// the return columns for every ticker the curated funds hold, plus the
// universe's most-held names. Runs at the end of build-consensus.mjs and on
// its own (scripts/build-stock-meta.mjs) against the committed files.
//
// Three files come out of it:
//   api/_data/sector-map.json   { updatedAt, bySymbol, caps, etf } — the cache.
//                               Sectors never expire (a company's SIC code
//                               changes about as often as its name); market
//                               caps carry the date they were priced.
//   client/public/returns.json  { updatedAt, returns: { SYM: {ret1y, retYtd,
//                               ret1d, asOf} } } — merged with the previous
//                               file, so a symbol that failed today keeps
//                               yesterday's number for a few days.
//   api/_data/guru-stocks.json  re-stamped with sector / marketCap / cap.
import fs from 'node:fs';
import path from 'node:path';
import { loadSectorMap, sectorsToFetch, mergeSectors, applyStockMeta } from './stockMeta.js';
import {
  priceSnapshots,
  fetchSecTickers,
  fetchSectors,
  fetchSharesOutstanding,
  marketCap,
} from './marketData.js';

const day = (ms) => new Date(ms).toISOString().slice(0, 10);

// Which symbols get a return column: the screener's whole table, the
// universe's most-held names, the consensus lists and the benchmarks.
export function returnsTickers({ guruStocks, stocks, consensus } = {}) {
  const set = new Set();
  for (const s of guruStocks?.stocks || []) if (s.ticker) set.add(String(s.ticker).toUpperCase());
  for (const r of stocks?.rows || []) if (r.ticker) set.add(String(r.ticker).toUpperCase());
  for (const list of [consensus?.mostHeld, consensus?.topBought, consensus?.topSold, consensus?.newPositions]) {
    for (const r of list || []) if (r.ticker) set.add(String(r.ticker).toUpperCase());
  }
  for (const s of ['SPY', 'QQQ', 'IWM']) set.add(s);
  return [...set];
}

const round = (x) => (x == null || !Number.isFinite(x) ? null : Number(x.toFixed(2)));

// Today's numbers over yesterday's file. A symbol the provider answered
// replaces its old row; one it did not keeps the old row while that is
// recent enough to still be roughly right, and drops out after that rather
// than showing a "1D" move from a week ago as today's.
export function mergeReturns(previous, snapshots, { now = Date.now(), maxAgeDays = 7 } = {}) {
  const out = {};
  const prevDate = previous?.updatedAt ? String(previous.updatedAt).slice(0, 10) : null;
  const cutoff = day(now - maxAgeDays * 86400 * 1000);
  for (const [sym, r] of Object.entries(previous?.returns || {})) {
    const asOf = r?.asOf || prevDate;
    if (asOf && asOf >= cutoff) out[sym] = { ...r, asOf };
  }
  let fresh = 0;
  for (const [sym, s] of snapshots) {
    if (!s) continue;
    out[sym] = { ret1y: round(s.ret1y), retYtd: round(s.retYtd), ret1d: round(s.ret1d), asOf: s.asOf };
    fresh++;
  }
  return { returns: out, fresh };
}

export async function buildStockMeta({
  root = process.cwd(),
  log = console.log,
  now = Date.now(),
  sectorBudget = Number(process.env.SECTOR_BUDGET || 2500),
} = {}) {
  const read = (rel) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
    } catch {
      return null;
    }
  };
  const write = (rel, data) => fs.writeFileSync(path.join(root, rel), JSON.stringify(data));

  const guruStocks = read('api/_data/guru-stocks.json');
  if (!guruStocks?.stocks) throw new Error('api/_data/guru-stocks.json is missing — run build-consensus.mjs first');
  const consensus = read('api/_data/consensus-pro.json');
  const universe = read('client/public/stocks.json');
  const stocks = guruStocks.stocks;

  // ---- price, returns, 52-week range per ticker, from the price store ----
  const tickers = returnsTickers({ guruStocks, stocks: universe, consensus });
  const { snapshots } = priceSnapshots(tickers, { now });
  const known = [...snapshots.values()].filter(Boolean).length;
  log(`Prices for ${tickers.length} tickers from the price store: ${known} on file, ${tickers.length - known} without a series yet`);

  // ---- returns.json ----
  const previousReturns = read('client/public/returns.json');
  const merged = mergeReturns(previousReturns, snapshots, { now });
  const total = Object.keys(merged.returns).length;
  if (merged.fresh === 0 && previousReturns) {
    log(`returns.json: nothing fetched — keeping the previous file (${Object.keys(previousReturns.returns || {}).length} tickers)`);
  } else {
    write('client/public/returns.json', { updatedAt: new Date(now).toISOString(), returns: merged.returns });
    log(`returns.json: ${total} tickers (${merged.fresh} refreshed today, ${total - merged.fresh} carried over)`);
  }

  // ---- sectors: SEC's SIC code per filer, cached for good ----
  let map = loadSectorMap();
  map = { ...map, caps: map.caps || {}, etf: map.etf || {} };

  let secIndex = new Map();
  try {
    secIndex = await fetchSecTickers();
  } catch (e) {
    log(`  SEC ticker index: ${e.message} — sectors and market caps skipped this run`);
  }
  const found = {};
  if (secIndex.size) {
    const wanted = sectorsToFetch(stocks, map, sectorBudget);
    const toLookUp = [];
    for (const sym of wanted) {
      if (map.etf[sym]) found[sym] = 'ETF';
      else if (secIndex.has(sym)) toLookUp.push(sym);
      // a symbol SEC's index does not carry is asked about again next run:
      // the index is refreshed daily and new listings appear in it late
    }
    log(`Looking up sectors for ${wanted.length} new symbols (${toLookUp.length} via SEC)…`);
    const ciks = [...new Set(toLookUp.map((sym) => secIndex.get(sym).cik))];
    const sectors = await fetchSectors(ciks);
    for (const sym of toLookUp) {
      const r = sectors.get(secIndex.get(sym).cik);
      if (!r) continue; // fetch failed: ask again next run
      found[sym] = r.sector ?? (map.etf[sym] ? 'ETF' : null);
    }
  }
  map = mergeSectors(map, found);

  // ---- market caps: SEC share count × the stored close ----
  let shares = new Map();
  if (secIndex.size) {
    try {
      shares = await fetchSharesOutstanding({ now: new Date(now) });
    } catch (e) {
      log(`  SEC shares outstanding: ${e.message}`);
    }
  }
  let priced = 0;
  for (const s of stocks) {
    const sym = s.ticker ? String(s.ticker).toUpperCase() : null;
    if (!sym) continue;
    const snap = snapshots.get(sym);
    const cik = secIndex.get(sym)?.cik;
    const sh = cik ? shares.get(cik) : null;
    const v = marketCap(sh?.shares, snap?.price);
    if (v) {
      map.caps[sym] = { v, asOf: snap.asOf, src: 'sec' };
      priced++;
    }
  }
  log(`  market caps: ${priced} from SEC share counts (${shares.size} filers in the frames)`);

  write('api/_data/sector-map.json', map);

  // ---- stamp the table ----
  const marketCaps = Object.fromEntries(Object.entries(map.caps).map(([sym, c]) => [sym, c.v]));
  const stamped = applyStockMeta(stocks, { sectors: map.bySymbol, marketCaps });
  write('api/_data/guru-stocks.json', { ...guruStocks, stocks: stamped });
  const withSector = stamped.filter((s) => s.sector).length;
  const withCap = stamped.filter((s) => s.marketCap).length;
  const withTicker = stamped.filter((s) => s.ticker).length;
  log(`stock meta: ${withSector}/${withTicker} tickered securities with a sector, ${withCap} with a market cap`);
  return { tickers: tickers.length, priced: known, returns: total, withSector, withCap, withTicker };
}
