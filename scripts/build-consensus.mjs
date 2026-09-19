// Precomputes the consensus page and 1Y/YTD returns as static JSON so the
// site serves them from the CDN instantly instead of parsing SEC filings
// per request. Runs daily via .github/workflows/consensus.yml (and after
// the weekly universe build).
//
//   node scripts/build-consensus.mjs
import fs from 'node:fs';
import path from 'node:path';
import { build } from '../api/_lib/consensusBuild.js';
import { buildStockMeta } from '../api/_lib/stockMetaBuild.js';

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

fs.writeFileSync(path.join(dataDir, 'consensus-pro.json'), JSON.stringify(core));
// Written bare here; the enrichment pass below stamps sector, market cap and
// the size bucket onto each row.
const stocks = rawStocks;
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

// ---- sector, market cap, returns ------------------------------------------
// One pass over every ticker the table holds: a chart each for price and the
// return columns, SEC's SIC code for the sector, SEC's share count for the
// market cap. Best-effort by design — a provider outage leaves the fields
// null and the filters offer less, but the consensus above still ships.
await buildStockMeta();
