// Sector, market cap and return columns for the per-security table, on their
// own. build-consensus.mjs runs the same pass at its end; this entry point
// re-runs it over the committed guru-stocks.json without the hour of filing
// crawl in front of it.
//
//   node scripts/build-stock-meta.mjs
//   SECTOR_BUDGET=250 node scripts/build-stock-meta.mjs   (fewer SEC lookups)
import { buildStockMeta } from '../api/_lib/stockMetaBuild.js';
import { flushProviderHealth } from '../api/_lib/providerAlarm.js';

await buildStockMeta();
flushProviderHealth();
