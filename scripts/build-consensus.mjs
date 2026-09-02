// Precomputes the consensus page and 1Y/YTD returns as static JSON so the
// site serves them from the CDN instantly instead of parsing SEC filings
// per request. Runs daily via .github/workflows/consensus.yml (and after
// the weekly universe build). Yahoo is reachable from GitHub runners.
//
//   node scripts/build-consensus.mjs
import fs from 'node:fs';
import path from 'node:path';
import { build } from '../api/_lib/consensusBuild.js';
import { yahooChartReturns } from '../api/_lib/yahooClient.js';
import { tdGet, hasTd } from '../api/_lib/providers.js';
import { returnsFromSeries } from '../api/_lib/stooq.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const pub = path.join(process.cwd(), 'client', 'public');
fs.mkdirSync(pub, { recursive: true });

// ---- consensus.json -------------------------------------------------------
console.log('Building consensus…');
const consensus = await build();
fs.writeFileSync(path.join(pub, 'consensus.json'), JSON.stringify(consensus));
console.log(
  `consensus.json: ${consensus.managers.length} managers, ${consensus.mostHeld.length} most-held`
);

// ---- returns.json ---------------------------------------------------------
// 1Y/YTD for the most-held tickers across the universe + consensus tickers.
const tickers = new Set();
try {
  const stocks = JSON.parse(fs.readFileSync(path.join(pub, 'stocks.json'), 'utf8'));
  for (const r of stocks.rows) if (r.ticker) tickers.add(r.ticker);
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
