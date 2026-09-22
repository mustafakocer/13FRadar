// Ten years of daily closes for every symbol the curated funds hold, into
// api/_data/prices/ — the cache dailyCloses() reads before any live
// provider, so the backtest, the price chart and the return columns answer
// from a file instead of a quota. Incremental: a symbol on file only fetches
// the days since its last close.
//
//   node scripts/build-prices.mjs
//   PRICES_DRY=1 node scripts/build-prices.mjs        plan only, nothing fetched
//   PRICES_YAHOO=0 PRICES_TD_BUDGET=750 …             keyed providers only
//
// Env: TWELVEDATA_API_KEY, FMP_API_KEY, FINNHUB_API_KEY (any subset);
// PRICES_YAHOO (default 1: Yahoo chart from the runner), PRICES_TD_BUDGET
// (400), PRICES_FMP_BUDGET (60), PRICES_FINNHUB_BUDGET (300),
// PRICES_MAX_AGE_DAYS (1). The log opens with the plan: how many symbols
// are missing or stale, what tonight covers, and how many nights a full
// fill takes at this budget.
import { buildPrices } from '../api/_lib/pricesBuild.js';

const r = await buildPrices();
if (r.dryRun) console.log('dry run — nothing written');
