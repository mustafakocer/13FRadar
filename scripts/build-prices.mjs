// Ten years of daily closes for every symbol the curated funds hold, into
// api/_data/prices/ — the cache dailyCloses() reads before any live
// provider, so the backtest, the price chart and the return columns answer
// from a file instead of a quota. Incremental: a symbol on file only fetches
// the days since its last close.
//
//   node scripts/build-prices.mjs
//   PRICES_DRY=1 node scripts/build-prices.mjs        plan only, nothing fetched
//   PRICES_FINNHUB_BUDGET=0 PRICES_TD_BUDGET=750 …    TwelveData only
//
// Env: TWELVEDATA_API_KEY, FINNHUB_API_KEY (any subset); PRICES_TD_BUDGET
// (400, history for symbols with no series), PRICES_FINNHUB_BUDGET (2400,
// the last close appended to series already on file),
// PRICES_MAX_AGE_DAYS (1). The log opens with the plan: how many symbols
// are missing or stale, what tonight covers, and how many nights a full
// fill takes at this budget.
import { buildPrices, finnhubRefusals, providerPlan, finnhubSummary } from '../api/_lib/pricesBuild.js';
import { waitForPeer } from './finnhub-peer.mjs';
import { flushProviderHealth } from '../api/_lib/providerAlarm.js';
import { tdGet } from '../api/_lib/providers.js';

// Without Finnhub only TwelveData's ~400 symbols a night are refreshed: say
// so where the run summary shows it rather than letting closes go stale.
for (const key of ['TWELVEDATA_API_KEY', 'FINNHUB_API_KEY']) {
  if (!process.env[key]) console.log(`::warning::price cache: ${key} is not set — that provider is skipped tonight`);
}

// What the day's TwelveData credits look like before the night spends them:
// the live site asks Finnhub first, so this is what is left for histories.
if (process.env.TWELVEDATA_API_KEY && process.env.PRICES_DRY !== '1') {
  try {
    const u = await tdGet('/api_usage');
    console.log(`twelvedata credits before tonight: ${u.current_usage} of ${u.plan_limit} used today, ${u.plan_limit - u.current_usage} left (${u.timestamp || ''})`);
  } catch (e) {
    console.log(`twelvedata credits before tonight: unknown (${String(e.message || e).slice(0, 120)})`);
  }
}

// The insider build shares the Finnhub key: let a running one finish first
// (scripts/finnhub-peer.mjs); if it is still going after 20 minutes, tonight
// runs without Finnhub rather than both throttling each other.
let providers = providerPlan();
if (providers.some((p) => p.name === 'finnhub') && process.env.PRICES_DRY !== '1') {
  const peer = await waitForPeer({ maxMs: Number(process.env.FINNHUB_PEER_WAIT_MIN || 20) * 60000 });
  if (!peer.clear) {
    console.log(`::warning::finnhub: ${process.env.FINNHUB_PEER_WORKFLOW} still running after ${Math.round(peer.waitedMs / 60000)} min — no Finnhub this run, the closes wait for the next`);
    providers = providers.filter((p) => p.name !== 'finnhub');
  }
}

const r = await buildPrices({ providers });
if (r.dryRun) console.log('dry run — nothing written');
finnhubSummary('price build');
// symbols the free Finnhub plan does not quote (HTTP 403 on that symbol)
if (finnhubRefusals()) console.log(`  finnhub: ${finnhubRefusals()} symbol(s) not covered by the plan (HTTP 403), skipped`);

flushProviderHealth();
