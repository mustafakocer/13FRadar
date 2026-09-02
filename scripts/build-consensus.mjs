// Precomputes the consensus page and 1Y/YTD returns as static JSON so the
// site serves them from the CDN instantly instead of parsing SEC filings
// per request. Runs daily via .github/workflows/consensus.yml (and after
// the weekly universe build). Yahoo is reachable from GitHub runners.
//
//   node scripts/build-consensus.mjs
import fs from 'node:fs';
import path from 'node:path';
import { build } from '../api/_lib/consensusBuild.js';
import { yahooChartReturns, mapLimit } from '../api/_lib/yahooClient.js';

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

const symbols = [...tickers].slice(0, 800);
console.log(`Fetching returns for ${symbols.length} tickers…`);
let failed = 0;
const rows = await mapLimit(symbols, 8, async (sym) => {
  try {
    const r = await yahooChartReturns(sym);
    return [sym, { ret1y: round(r.ret1y), retYtd: round(r.retYtd), ret1d: round(r.ret1d) }];
  } catch {
    failed++;
    return null;
  }
});

function round(x) {
  return x == null ? null : Number(x.toFixed(2));
}

const ok = rows.filter(Boolean);
if (ok.length < symbols.length * 0.3) {
  console.warn(`Only ${ok.length}/${symbols.length} returns fetched — keeping previous returns.json`);
} else {
  fs.writeFileSync(
    path.join(pub, 'returns.json'),
    JSON.stringify({ updatedAt: new Date().toISOString(), returns: Object.fromEntries(ok) })
  );
  console.log(`returns.json: ${ok.length} tickers (${failed} failed)`);
}
