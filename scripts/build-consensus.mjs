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
import { retryUnresolved } from '../api/_lib/figi.js';
import { persist as persistMaster, stats as masterStats } from '../api/_lib/securityMaster.js';

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
// `quarter`, `coverage` (tracked → filed → counted) and `activity` (the five
// biggest net buys and sells, the same rows the rankings rank) ride along so
// the landing page and the consensus page count and quote the same numbers
// as every other page.
const { updatedAt, quarter, coverage, managers, mostHeld, updates, activity } = consensus;
fs.writeFileSync(
  path.join(pub, 'consensus.json'),
  JSON.stringify({ updatedAt, quarter, coverage, managers, mostHeld, updates, activity })
);
const dataDir = path.join(process.cwd(), 'api', '_data');
fs.mkdirSync(dataDir, { recursive: true });
// The per-stock table is the bulky part and only the stock page, the ownership
// rankings and the screener read it, so it gets its own file rather than
// riding along in every /api/consensus response.
const { stocks: rawStocks, exited, options, ...core } = consensus;

fs.writeFileSync(path.join(dataDir, 'consensus-pro.json'), JSON.stringify(core));
// Written bare here; the enrichment pass below stamps sector, market cap and
// the size bucket onto each row. `exited` (names the whole panel sold out
// of) is what the /report pivot needs for "most sold"; the rankings read
// `stocks` alone.
const stocks = rawStocks;
fs.writeFileSync(
  path.join(dataDir, 'guru-stocks.json'),
  JSON.stringify({ updatedAt, quarter, coverage, managers, stocks, exited, options })
);
console.log(
  `consensus.json (public) + consensus-pro.json: ${managers.length} managers, ${mostHeld.length} most-held, ${consensus.topBought.length} bought, ${consensus.newPositions.length} new, ${updates.length} update cards`
);
console.log(
  `coverage ${quarter}: ${coverage.tracked} tracked, ${coverage.filed} filed, ${coverage.included} counted (${Object.entries(coverage.excluded).map(([k, v]) => `${v} ${k}`).join(', ') || 'none excluded'})`
);
console.log(
  `guru-stocks.json: ${stocks.length} securities (${stocks.filter((s) => s.ticker).length} with a ticker), ${options.length} option lines`
);

// ---- security master --------------------------------------------------------
// Identifiers OpenFIGI could not map get one more try a day, bounded; then
// the master (and the derived flat map) is written for the commit.
{
  const before = masterStats();
  const r = await retryUnresolved({ limit: Number(process.env.FIGI_RETRY_BUDGET || 200) });
  persistMaster({ force: true });
  const after = masterStats();
  console.log(
    `security master: ${after.resolved} resolved, ${after.unresolved} unresolved (before: ${before.resolved}/${before.unresolved}; retried ${r.due}, recovered ${r.resolved}); ${stocks.filter((s) => !s.ticker).length} of ${stocks.length} table rows without a ticker`
  );
}

// ---- sector, market cap, returns ------------------------------------------
// One pass over every ticker the table holds: a chart each for price and the
// return columns, SEC's SIC code for the sector, SEC's share count for the
// market cap. Best-effort by design — a provider outage leaves the fields
// null and the filters offer less, but the consensus above still ships.
await buildStockMeta();
