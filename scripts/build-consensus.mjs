// Precomputes the consensus page and 1Y/YTD returns as static JSON so the
// site serves them from the CDN instantly instead of parsing SEC filings
// per request. Runs daily via .github/workflows/consensus.yml (and after
// the weekly universe build). Yahoo is reachable from GitHub runners.
//
//   node scripts/build-consensus.mjs
import fs from 'node:fs';
import path from 'node:path';
import { build } from '../api/_lib/consensusBuild.js';
import { yahooChartReturns, yahooQuote, yahooQuoteSummary, mapLimit } from '../api/_lib/yahooClient.js';
import { loadSectorMap, sectorsToFetch, mergeSectors, applyStockMeta } from '../api/_lib/stockMeta.js';
import { tdGet, hasTd } from '../api/_lib/providers.js';
import { returnsFromSeries } from '../api/_lib/stooq.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const pub = path.join(process.cwd(), 'client', 'public');
fs.mkdirSync(pub, { recursive: true });

// ---- consensus.json -------------------------------------------------------
console.log('Building consensus…');
// The runner has an OpenFIGI key and no request deadline, so this is where the
// per-stock table earns its tickers; /api/consensus takes the static map only.
const consensus = await build({ stocksTickers: Number(process.env.CONSENSUS_FIGI_BUDGET || 1500) });
// Public file: the free part — most-held plus the per-manager "what changed"
// teaser cards for the landing page. Full buys/sells/new-position lists are
// Pro data and go to api/_data (served by /api/consensus behind the paywall).
const { updatedAt, managers, mostHeld, updates } = consensus;
fs.writeFileSync(
  path.join(pub, 'consensus.json'),
  JSON.stringify({ updatedAt, managers, mostHeld, updates })
);
const dataDir = path.join(process.cwd(), 'api', '_data');
fs.mkdirSync(dataDir, { recursive: true });
// The per-stock table is the bulky part and only the stock page, the ownership
// rankings and the screener read it, so it gets its own file rather than
// riding along in every /api/consensus response.
const { stocks: rawStocks, options, ...core } = consensus;

// ---- sector + market cap for the per-security table ------------------------
// Sectors accumulate in a committed map a few hundred symbols at a time;
// market caps are bulk-quoted every run. Both are best-effort: a provider
// hiccup leaves the fields null and the filters simply offer less.
const sectorMap = loadSectorMap();
const wanted = sectorsToFetch(rawStocks, sectorMap, Number(process.env.SECTOR_BUDGET || 250));
const found = {};
if (wanted.length) {
  console.log(`Looking up sectors for ${wanted.length} new symbols…`);
  const got = await mapLimit(wanted, 4, async (sym) => {
    try {
      const r = await yahooQuoteSummary(sym, ['assetProfile']);
      return r?.assetProfile?.sector || null;
    } catch {
      return undefined; // ask again next run rather than storing a failure
    }
  });
  got.forEach((sector, i) => {
    if (sector !== undefined) found[wanted[i]] = sector;
  });
}
const sectors = mergeSectors(sectorMap, found);
if (Object.keys(found).length) {
  fs.writeFileSync(path.join(process.cwd(), 'api', '_data', 'sector-map.json'), JSON.stringify(sectors));
}

const marketCaps = {};
const capSymbols = rawStocks.map((s) => s.ticker).filter(Boolean).slice(0, Number(process.env.MARKETCAP_BUDGET || 900));
for (let i = 0; i < capSymbols.length; i += 50) {
  const chunk = capSymbols.slice(i, i + 50);
  try {
    for (const q of await yahooQuote(chunk)) {
      if (q?.symbol && q.marketCap != null) marketCaps[String(q.symbol).toUpperCase()] = q.marketCap;
    }
  } catch (e) {
    console.warn(`market cap batch ${i / 50 + 1} failed: ${e.message}`);
  }
  await sleep(250);
}

const stocks = applyStockMeta(rawStocks, { sectors: sectors.bySymbol, marketCaps });
console.log(
  `stock meta: ${stocks.filter((s) => s.sector).length}/${stocks.length} with a sector, ${stocks.filter((s) => s.marketCap).length} with a market cap`
);
fs.writeFileSync(path.join(dataDir, 'consensus-pro.json'), JSON.stringify(core));
fs.writeFileSync(
  path.join(dataDir, 'guru-stocks.json'),
  JSON.stringify({ updatedAt, managers, stocks, options })
);
console.log(
  `consensus.json (public) + consensus-pro.json: ${managers.length} managers, ${mostHeld.length} most-held, ${consensus.topBought.length} bought, ${consensus.newPositions.length} new, ${updates.length} update cards`
);
console.log(
  `guru-stocks.json: ${stocks.length} securities (${stocks.filter((s) => s.ticker).length} with a ticker), ${options.length} option lines`
);

// ---- returns.json ---------------------------------------------------------
// 1Y/YTD for the most-held tickers across the universe + consensus tickers.
const tickers = new Set();
try {
  const universe = JSON.parse(fs.readFileSync(path.join(pub, 'stocks.json'), 'utf8'));
  for (const r of universe.rows) if (r.ticker) tickers.add(r.ticker);
} catch {
  /* stocks.json optional */
}
for (const list of [consensus.mostHeld, consensus.topBought, consensus.topSold, consensus.newPositions]) {
  for (const r of list || []) if (r.ticker) tickers.add(r.ticker);
}
for (const s of ['SPY', 'QQQ', 'IWM']) tickers.add(s);

const symbols = [...tickers].slice(0, 400);
console.log(`Fetching returns for ${symbols.length} tickers…`);
let failed = 0;
const rows = [];

function round(x) {
  return x == null ? null : Number(x.toFixed(2));
}

async function tdReturns(sym) {
  const d = await tdGet('/time_series', { symbol: sym, interval: '1day', outputsize: 270 });
  const vals = d?.values || [];
  const prices = vals
    .map((v) => ({ date: v.datetime.slice(0, 10), close: Number(v.close) }))
    .filter((v) => Number.isFinite(v.close))
    .reverse();
  if (!prices.length) throw new Error('empty');
  return returnsFromSeries(sym, prices);
}

if (hasTd()) {
  // Twelve Data free tier: 8 credits/minute — pace at 7 symbols per minute.
  for (let i = 0; i < symbols.length; i += 7) {
    const chunk = symbols.slice(i, i + 7);
    await Promise.all(
      chunk.map(async (sym) => {
        try {
          const r = await tdReturns(sym);
          rows.push([sym, { ret1y: round(r.ret1y), retYtd: round(r.retYtd), ret1d: round(r.ret1d) }]);
        } catch {
          failed++;
        }
      })
    );
    if (i % 70 === 0) console.log(`  ${Math.min(i + 7, symbols.length)}/${symbols.length}`);
    if (i + 7 < symbols.length) await sleep(62000);
  }
} else {
  // no TD key: try Yahoo (works locally, usually blocked from datacenters)
  for (const sym of symbols) {
    try {
      const r = await yahooChartReturns(sym);
      rows.push([sym, { ret1y: round(r.ret1y), retYtd: round(r.retYtd), ret1d: round(r.ret1d) }]);
    } catch {
      failed++;
      if (failed > 10 && rows.length === 0) break; // provider clearly blocked
    }
  }
}

const ok = rows;
if (ok.length < symbols.length * 0.3) {
  console.warn(`Only ${ok.length}/${symbols.length} returns fetched — keeping previous returns.json`);
} else {
  fs.writeFileSync(
    path.join(pub, 'returns.json'),
    JSON.stringify({ updatedAt: new Date().toISOString(), returns: Object.fromEntries(ok) })
  );
  console.log(`returns.json: ${ok.length} tickers (${failed} failed)`);
}
