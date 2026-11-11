// The enrichment pass over the per-security table: sector, market cap and
// the return columns for every ticker the curated funds hold, plus the
// universe's most-held names. Runs at the end of build-consensus.mjs and on
// its own (scripts/build-stock-meta.mjs) against the committed files.
//
// Three files come out of it:
//   api/_data/sector-map.json   { updatedAt, bySymbol, caps, etf } — the cache.
//                               Sectors never expire (a company's SIC code
//                               changes about as often as its name); market
//                               caps carry the date they were priced and the
//                               count behind them (screenerCap below).
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
import { adrResolver } from './adrResolve.js';

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
// than showing a "1D" move from a week ago as today's. The same shelf life
// applies to a snapshot whose last close is old: a security that stopped
// trading (WBD, QRVO, KVUE… taken over in 2026 Q4) keeps its final close in
// the price store for good, and its row used to come back every night with
// a month-old "1D" move. Dropping it is the point: a return column is a
// statement about today's price.
export const RETURNS_MAX_AGE_DAYS = 7;
export const returnsCutoff = (now = Date.now(), maxAgeDays = RETURNS_MAX_AGE_DAYS) => day(now - maxAgeDays * 86400 * 1000);
export function mergeReturns(previous, snapshots, { now = Date.now(), maxAgeDays = RETURNS_MAX_AGE_DAYS } = {}) {
  const out = {};
  const prevDate = previous?.updatedAt ? String(previous.updatedAt).slice(0, 10) : null;
  const cutoff = returnsCutoff(now, maxAgeDays);
  for (const [sym, r] of Object.entries(previous?.returns || {})) {
    const asOf = r?.asOf || prevDate;
    if (asOf && asOf >= cutoff) out[sym] = { ...r, asOf };
  }
  let fresh = 0;
  let expired = 0;
  for (const [sym, s] of snapshots) {
    if (!s) continue;
    if (!s.asOf || s.asOf < cutoff) {
      // the store's last close is past the shelf life: no row, whatever
      // yesterday's file said
      if (sym in out) delete out[sym];
      expired++;
      continue;
    }
    out[sym] = { ret1y: round(s.ret1y), retYtd: round(s.retYtd), ret1d: round(s.ret1d), asOf: s.asOf };
    fresh++;
  }
  return { returns: out, fresh, expired };
}

// The screener's market cap for one symbol: { v, src }, null for "there is
// no count to price" (a cap on file is withdrawn), undefined for "nothing to
// say tonight" (a cap on file stays).
//
// The count is the one the stock page already uses — the fundamentals
// record (secFundamentals.js): per US-listed security, every share class in
// the listed share's units, restated for splits, and refused when the
// filer's own figures disagree. The screener used to multiply the raw cover
// count from SEC's frames by the price instead, with none of that: BeOne's
// 1.48 billion ordinary shares times the price of an ADS of thirteen put a
// $48 billion company at $620 billion and in the "mega" bucket, on the same
// day its own page said $47.7 billion. A symbol the fundamentals build has no
// record for still falls back to the frames — through the ADR ratio, and
// not at all for an ADS whose ratio nobody has documented.
//   rec          api/_data/fundamentals.json byTicker[sym]
//   frameShares  the filer's cover count from the XBRL frames
//   adr          adrResolve.js: { ratio, unknown }
export function screenerCap({ price, rec = null, frameShares = null, adr = null } = {}) {
  if (!(Number.isFinite(price) && price > 0)) return undefined;
  if (rec) {
    const v = marketCap(rec.shares?.value, price);
    return v ? { v, src: 'fundamentals' } : null;
  }
  if (adr?.unknown) return null;
  const v = marketCap(frameShares > 0 ? frameShares / (adr?.ratio > 0 ? adr.ratio : 1) : null, price);
  return v ? { v, src: 'sec' } : undefined;
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
    log(`returns.json: ${total} tickers (${merged.fresh} refreshed today, ${total - merged.fresh} carried over, ${merged.expired} dropped: last close older than ${RETURNS_MAX_AGE_DAYS} days)`);
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

  // ---- market caps: the share count × the stored close (screenerCap) ----
  let shares = new Map();
  if (secIndex.size) {
    try {
      shares = await fetchSharesOutstanding({ now: new Date(now) });
    } catch (e) {
      log(`  SEC shares outstanding: ${e.message}`);
    }
  }
  const fundamentals = read('api/_data/fundamentals.json')?.byTicker || {};
  const adrOf = adrResolver(root);
  let priced = 0;
  let fromFrames = 0;
  let withdrawn = 0;
  for (const s of stocks) {
    const sym = s.ticker ? String(s.ticker).toUpperCase() : null;
    if (!sym) continue;
    const snap = snapshots.get(sym);
    const cik = secIndex.get(sym)?.cik;
    const cap = screenerCap({ price: snap?.price, rec: fundamentals[sym], frameShares: cik ? shares.get(cik)?.shares : null, adr: adrOf(sym, cik) });
    if (cap) {
      map.caps[sym] = { v: cap.v, asOf: snap.asOf, src: cap.src };
      priced++;
      if (cap.src === 'sec') fromFrames++;
    } else if (cap === null && map.caps[sym]) {
      delete map.caps[sym];
      withdrawn++;
    }
  }
  log(`  market caps: ${priced} priced (${priced - fromFrames} from the fundamentals file, ${fromFrames} from SEC's share-count frames), ${withdrawn} withdrawn (no share count to stand on)`);

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
