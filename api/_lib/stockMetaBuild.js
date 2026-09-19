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
import axios from 'axios';
import { loadSectorMap, sectorsToFetch, mergeSectors, applyStockMeta } from './stockMeta.js';
import {
  fetchCharts,
  fetchSecTickers,
  fetchSectors,
  fetchSharesOutstanding,
  marketCap,
} from './marketData.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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

// The symbols whose cap is missing or older than a week, best-ranked first,
// for a per-symbol provider with a small daily quota.
export function capsToRefresh(stocks, caps, { now = Date.now(), maxAgeDays = 7, budget = 0 } = {}) {
  if (!budget) return [];
  const cutoff = day(now - maxAgeDays * 86400 * 1000);
  const out = [];
  for (const s of stocks) {
    if (out.length >= budget) break;
    const sym = s.ticker ? String(s.ticker).toUpperCase() : null;
    if (!sym) continue;
    const have = caps?.[sym];
    if (have && have.v > 0 && have.asOf >= cutoff) continue;
    out.push(sym);
  }
  return out;
}

// FMP's free plan still answers one symbol per call, a few hundred a day.
// That is enough to fill the market caps SEC cannot price — dual-class
// names whose share count is reported per class, foreign filers, funds —
// for the best-ranked names, a slice per run.
async function fmpProfile(symbol, key) {
  const r = await axios.get('https://financialmodelingprep.com/stable/profile', {
    params: { symbol, apikey: key },
    timeout: 15000,
    validateStatus: () => true,
  });
  if (r.status !== 200 || !Array.isArray(r.data) || !r.data.length) {
    const body = typeof r.data === 'object' && r.data ? JSON.stringify(r.data) : String(r.data ?? '');
    throw new Error(`HTTP ${r.status} ${body.split(key).join('***').slice(0, 120)}`);
  }
  const p = r.data[0];
  return {
    marketCap: Number(p.marketCap) || null,
    sector: p.sector || null,
    etf: Boolean(p.isEtf),
  };
}

export async function buildStockMeta({
  root = process.cwd(),
  log = console.log,
  now = Date.now(),
  sectorBudget = Number(process.env.SECTOR_BUDGET || 2500),
  fmpKey = process.env.FMP_API_KEY || null,
  fmpBudget = Number(process.env.FMP_BUDGET || 100),
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

  // ---- one chart per ticker: price, returns, 52-week range, fund flag ----
  const tickers = returnsTickers({ guruStocks, stocks: universe, consensus });
  log(`Fetching charts for ${tickers.length} tickers…`);
  const { snapshots, failed, blocked } = await fetchCharts(tickers, {
    now,
    onProgress: (d, n) => log(`  ${d}/${n}`),
  });
  const known = [...snapshots.values()].filter(Boolean).length;
  const unknown = [...snapshots.values()].filter((s) => s === null).length;
  log(`  charts: ${known} priced, ${unknown} unknown to the provider, ${failed} failed${blocked ? ' — provider blocked, stopped early' : ''}`);

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
  for (const [sym, s] of snapshots) if (s?.etf) map.etf[sym] = 1;

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

  // ---- market caps: SEC share count × chart price ----
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

  // ---- the gaps, from FMP one symbol at a time ----
  if (fmpKey && fmpBudget > 0) {
    const gaps = capsToRefresh(stocks, map.caps, { now, budget: fmpBudget });
    let got = 0;
    let refused = 0;
    for (const sym of gaps) {
      if (refused >= 3) break;
      try {
        const p = await fmpProfile(sym, fmpKey);
        if (p.marketCap) {
          map.caps[sym] = { v: Math.round(p.marketCap), asOf: day(now), src: 'fmp' };
          got++;
        }
        if (map.bySymbol[sym] == null && p.sector) map.bySymbol[sym] = p.sector;
        if (p.etf) map.etf[sym] = 1;
        refused = 0;
      } catch (e) {
        refused++;
        log(`  FMP ${sym}: ${e.message}`);
      }
      await sleep(300);
    }
    log(`  market caps: ${got} of ${gaps.length} gaps filled from FMP`);
  }

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
