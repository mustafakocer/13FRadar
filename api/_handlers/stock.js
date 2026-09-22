import { cached, TTL, remember, recall } from '../_lib/cache.js';
import { readFixture } from '../_lib/fixtures.js';
import { hasFmp, hasTd, hasFinnhub, fmpStock, tdStock, finnhubStock } from '../_lib/providers.js';
import { priceSnapshot, priceUnavailable } from '../_lib/priceSnapshot.js';
import { noteOk, noteFail, noteServed, noteCall, shouldSkip, quotaState, servedHeader } from '../_lib/providerHealth.js';

// GET /api/stock/:ticker — the quote board of a stock page.
//
// This answer is cache-first and always 200. The keyed providers are asked
// all at once (raceProviders) inside a fixed wall-clock budget; the answer
// is the best-ranked one that lands in time, and when none does the request
// is answered from the freshest of: the last live answer this instance saw
// (`remember`), the nightly price file (dated, with `priceStale: true`), or
// a payload whose price fields are all null. The race keeps running after
// the response so the next request on a warm instance finds a better
// answer in the cache. Every answer says which provider served it and how
// each one did (X-Stock-* headers, api/_lib/providerHealth.js).
//
// The chain is keyed providers only. Yahoo (quoteSummary, quote, chart) and
// Stooq are out for good: from Vercel's IP range Yahoo answers 429 on every
// endpoint and Stooq serves a JavaScript-challenge HTML page instead of
// CSV — a day of X-Stock-Chain said exactly that, on every request — so
// they cost budget and never a price. The nightly builds still read Yahoo's
// chart endpoint from GitHub runners, where it answers.
//
//   FMP         quote + profile + TTM ratios (the complete board; 250/day free)
//   TwelveData  quote (800/day free)
//   Finnhub     quote (60/min free, no daily cap)
//
// Quotas are tracked per instance (providerHealth.js): a provider that
// answered 429 today is exhausted until UTC midnight, and one that is near
// its daily limit is held back while another keyed provider can answer, so
// the last calls of the day are not spent while a peer sits idle.
const UPSTREAM_BUDGET_MS = Math.max(500, Number(process.env.STOCK_UPSTREAM_MS) || 3000);
// With a dated close on file the page has something true to show, so the
// live chain gets half the budget before the file answers and the chain
// finishes in the background; only a symbol nothing has ever priced waits
// the full budget for a live quote.
const SNAPSHOT_BUDGET_MS = Math.max(500, Number(process.env.STOCK_SNAPSHOT_MS) || Math.round(UPSTREAM_BUDGET_MS / 2));

// The providers, most complete answer first. Each is a thunk so a test can
// hand in its own list; `needs` says which key must be present.
const PROVIDERS = [
  { name: 'fmp', needs: hasFmp, run: (t) => fmpStock(t) },
  { name: 'twelvedata', needs: hasTd, run: (t) => tdStock(t) },
  { name: 'finnhub', needs: hasFinnhub, run: (t) => finnhubStock(t) },
];

// Which of the providers to call now. A provider without its key is never
// called; one whose breaker is open (three failures in a row) or whose
// daily quota is exhausted is skipped while another keyed provider can
// answer; one near its daily limit (`conserve`) likewise steps aside for a
// peer with room. When nothing else is left, the quota-limited provider is
// still asked: a throttled answer costs one call, the nightly file costs a
// day of staleness.
export function eligibleProviders(providers, { now = Date.now(), quota = quotaState } = {}) {
  const out = [];
  const keyed = providers.filter((p) => !p.needs || p.needs());
  for (const p of providers) if (!keyed.includes(p)) out.push({ p, why: 'key' });
  const open = keyed.filter((p) => shouldSkip(p.name, now));
  const fresh = keyed.filter((p) => !open.includes(p));
  const exhausted = fresh.filter((p) => quota(p.name, now).exhausted);
  const withRoom = fresh.filter((p) => !exhausted.includes(p));
  const conserving = withRoom.filter((p) => quota(p.name, now).conserve);
  const preferred = withRoom.filter((p) => !conserving.includes(p));
  const run = preferred.length ? preferred : withRoom.length ? withRoom : fresh;
  for (const p of keyed) {
    if (run.includes(p)) out.push({ p, why: null });
    else if (open.includes(p)) out.push({ p, why: 'open' });
    else if (exhausted.includes(p)) out.push({ p, why: 'quota' });
    else out.push({ p, why: 'conserve' });
  }
  return out;
}

// Returns { withinBudget, eventual, chain } — `chain` is one line per
// provider: name=outcome:ms, outcome being ok, or the failure class
// (throttle / forbidden / key / timeout / parse / upstream / network), or
// why it was not called (key / open / quota / conserve).
export function raceProviders(ticker, { providers = PROVIDERS, budgetMs = UPSTREAM_BUDGET_MS, log = () => {}, now = Date.now } = {}) {
  const outcomes = new Map(providers.map((p) => [p.name, 'pending']));
  const line = () => [...outcomes].map(([n, o]) => `${n}=${o}`).join(';');
  const eligible = [];
  for (const { p, why } of eligibleProviders(providers, { now: now() })) {
    if (why) outcomes.set(p.name, `${why}:0`);
    else eligible.push(p);
  }
  const results = eligible.map((p) => {
    const t0 = now();
    noteCall(p.name, t0);
    return Promise.resolve()
      .then(() => p.run(ticker))
      .then((out) => {
        const ms = now() - t0;
        if (out) {
          noteOk(p.name, ms);
          outcomes.set(p.name, `ok:${ms}`);
          log(`${p.name} ok in ${ms}ms`);
          return out;
        }
        noteFail(p.name, new Error('empty'), ms);
        outcomes.set(p.name, `parse:${ms}`);
        log(`${p.name} empty in ${ms}ms`);
        return null;
      })
      .catch((e) => {
        const ms = now() - t0;
        const kind = noteFail(p.name, e, ms, { now: now() });
        outcomes.set(p.name, `${kind}:${ms}`);
        log(`${p.name} ${kind} in ${ms}ms: ${String(e?.message || e).slice(0, 120)}`);
        return null;
      });
  });
  const settled = results.map(() => false);
  const values = results.map(() => null);
  results.forEach((r, i) =>
    r.then((v) => {
      settled[i] = true;
      values[i] = v;
    })
  );
  // the best-ranked answer settled so far; undefined while a better-ranked
  // provider could still answer within the budget
  const bestNow = () => {
    for (let i = 0; i < results.length; i++) {
      if (!settled[i]) return undefined;
      if (values[i]) return { data: values[i], provider: eligible[i].name };
    }
    return null;
  };
  const anyNow = () => {
    for (let i = 0; i < results.length; i++) if (settled[i] && values[i]) return { data: values[i], provider: eligible[i].name };
    return null;
  };
  const withinBudget = new Promise((resolve) => {
    if (!results.length) return resolve(null);
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(v);
    };
    const timer = setTimeout(() => finish(anyNow()), budgetMs);
    results.forEach((r) =>
      r.then(() => {
        const b = bestNow();
        if (b !== undefined) finish(b);
      })
    );
  });
  const race = { withinBudget, eventual: null, settledBest: null, chain: line };
  race.eventual = Promise.all(results).then(() => {
    race.settledBest = anyNow();
    return race.settledBest;
  });
  return race;
}

// Live within the budget, else the freshest fallback: last live answer on
// this instance → nightly price file → all-null price block. Exported so the
// SSR loader and tests exercise the same decision the HTTP handler makes.
export async function stockPayload(ticker, { budgetMs = null, log = () => {}, providers = PROVIDERS } = {}) {
  const key = `stock:${ticker}`;
  const started = Date.now();
  const snap = priceSnapshot(ticker);
  if (budgetMs == null) budgetMs = snap ? SNAPSHOT_BUDGET_MS : UPSTREAM_BUDGET_MS;
  // One in-flight race per symbol per instance; a second request within the
  // TTL joins it rather than starting another round of provider calls.
  const race = await cached(key, TTL.MIN_5 * 2, async () => {
    const r = raceProviders(ticker, { providers, budgetMs, log });
    r.eventual.then((best) => {
      if (best) remember(key, { ...best.data, provider: best.provider });
    });
    return r;
  });
  // a race that missed its budget on the first request may have finished
  // since; that answer is this instance's live one
  const best = (await race.withinBudget) || race.settledBest;
  const chain = race.chain();
  if (best) {
    noteServed('live');
    return { data: { ...best.data, provider: best.provider }, served: 'live', provider: best.provider, chain, ms: Date.now() - started };
  }
  const why = 'no provider answered within the budget';
  const stale = recall(key);
  if (stale) {
    log(`${why} → last live answer (${stale.provider || stale.source})`);
    noteServed('stale');
    return { data: { ...stale, stale: true, priceStale: true }, served: 'stale', provider: stale.provider || null, chain, ms: Date.now() - started };
  }
  if (snap) {
    log(`${why} → nightly snapshot (${snap.priceAsOf})`);
    noteServed('snapshot');
    return { data: snap, served: 'snapshot', provider: null, chain, ms: Date.now() - started };
  }
  log(`${why} → no price`);
  noteServed('none');
  return { data: priceUnavailable(ticker), served: 'none', provider: null, chain, ms: Date.now() - started };
}

export default async function handler(req, res) {
  const ticker = String(req.query.ticker || '').trim().toUpperCase();
  if (!ticker) return res.status(400).json({ error: 'Missing ticker' });
  const fx = readFixture(`stock/${ticker}.json`);
  if (fx) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(fx);
  }

  const log = (msg) => console.log(`stock ${ticker}: ${msg}`);
  const { data, served, provider, chain, ms } = await stockPayload(ticker, { log });
  log(`served ${served}${provider ? ` (${provider})` : ''} in ${ms}ms [${chain}] totals ${servedHeader()}`);
  // A fallback answer is kept only briefly at the CDN so the live one takes
  // over as soon as a provider answers.
  res.setHeader(
    'Cache-Control',
    served === 'live' ? 's-maxage=600, stale-while-revalidate=3600' : 's-maxage=60, stale-while-revalidate=600'
  );
  // live | stale | snapshot | none — and which provider, how each one did,
  // and the instance's running distribution, so a day of "snapshot" is
  // diagnosable from the response alone.
  res.setHeader('X-Stock-Source', served);
  if (provider) res.setHeader('X-Stock-Provider', provider);
  res.setHeader('X-Stock-Chain', chain || 'none');
  res.setHeader('X-Stock-Served', servedHeader());
  res.setHeader('X-Stock-Ms', String(ms));
  res.status(200).json(data);
}
