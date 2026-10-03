// The nightly price build: which symbols need a series, from where, within
// which quota — and the fetchers, one per provider, each answering
// [{date, close}] ascending, null for a symbol the provider does not know,
// and throwing for anything transient. The planning is pure and tested; the
// fetchers are thin. scripts/build-prices.mjs is the entry point.
//
// Sources, in the order they are asked (Yahoo and FMP are out of every
// chain: their terms do not cover showing the data on a paid site):
//   twelvedata  /time_series, 5000 rows a call, 800 credits a day and 8 a
//               minute on the free plan (a batch call is one credit per
//               symbol, so batching buys nothing): the build paces at the
//               minute limit and spends PRICES_TD_BUDGET a night. It takes
//               the symbols with no series first — the history.
//   finnhub     /quote — the last close, 60 calls a minute and no daily cap
//               on the free plan: appended to a series that has its history
//               already, so the closes stay current without a history call.
//               (Its /stock/candle history is off the free plan.) A 403 on
//               /quote is about that one symbol (the free plan does not cover
//               every listing), not the key: the symbol is skipped, and only
//               a run of refusals in a row means the account is refused.
import axios from 'axios';
import fs from 'node:fs';
import path from 'node:path';
import { tdGet, hasTd, hasFinnhub } from './providers.js';
import { readSeries, writeSeries, seriesIndex, seriesKey, seriesAgeDays, mergeSeries, returnsFromSeries, pricesDir } from './priceStore.js';
import { noteProvider } from './providerAlarm.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 86400 * 1000;
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

export const BENCHMARKS = ['SPY', 'QQQ', 'IWM'];
export const HISTORY_YEARS = 10;

// A listed ticker: letters, digits, a class dash or dot; not a bond
// description ("ECHO 3.875 11-30-30") or a placeholder ("TMHC*").
export const listedTicker = (t) => /^[A-Z][A-Z0-9]{0,5}([.-][A-Z0-9]{1,3})?$/.test(String(t || '').toUpperCase());

// The symbols to price, best-ranked first: the benchmarks, the per-security
// table in rank order (most held first), then names the panel sold out of
// (the backtest's older quarters hold them).
export function universeSymbols({ guruStocks, insiderTickers = [] } = {}) {
  const out = [];
  const seen = new Set();
  const add = (t) => {
    const sym = String(t || '').toUpperCase();
    if (!listedTicker(sym) || seen.has(seriesKey(sym))) return;
    seen.add(seriesKey(sym));
    out.push(sym);
  };
  for (const b of BENCHMARKS) add(b);
  for (const s of guruStocks?.stocks || []) add(s.ticker);
  for (const s of guruStocks?.exited || []) add(s.ticker);
  // then the tickers insiders traded recently (newest first): their pages
  // and the insider returns read the same closes
  for (const t of insiderTickers) add(t);
  return out;
}

// Tickers insiders traded in the last `days` days of the dataset, the most
// recently traded first.
export function recentInsiderTickers(db, { days = 90 } = {}) {
  const rows = db?.rows || [];
  const last = rows.reduce((m, r) => (r.f > m ? r.f : m), '');
  if (!last) return [];
  const since = isoDay(Date.parse(`${last}T00:00:00Z`) - days * DAY);
  const newest = new Map();
  for (const r of rows) if (r.t && r.f >= since && (!newest.has(r.t) || r.f > newest.get(r.t))) newest.set(r.t, r.f);
  return [...newest].sort((a, b) => (a[1] < b[1] ? 1 : a[1] > b[1] ? -1 : 0)).map(([t]) => t);
}

// What tonight fetches, in order: symbols with no series at all (in
// universe order, so the most-held names land first), then series whose
// last close is older than `maxAgeDays` (oldest first). A series fresh
// enough is left alone. `capacity` is the calls the night can spend; the
// plan says how many nights the whole universe needs at that rate.
// A series of a few closes (quotes appended to a symbol no history call has
// reached yet) still needs its history: it counts as missing.
export const MIN_HISTORY_ROWS = 20;

export function planFetch(symbols, index, { now = Date.now(), maxAgeDays = 1, capacity = Infinity } = {}) {
  const missing = [];
  const stale = [];
  let fresh = 0;
  for (const sym of symbols) {
    const have = index.get(seriesKey(sym));
    if (!have?.asOf || (have.rows != null && have.rows < MIN_HISTORY_ROWS)) missing.push({ symbol: sym, from: null, reason: 'missing' });
    else if (seriesAgeDays(have.asOf, now) > maxAgeDays) stale.push({ symbol: sym, from: have.asOf, reason: 'stale', asOf: have.asOf });
    else fresh++;
  }
  stale.sort((a, b) => (a.asOf < b.asOf ? -1 : a.asOf > b.asOf ? 1 : 0));
  const jobs = [...missing, ...stale];
  const tonight = Number.isFinite(capacity) ? jobs.slice(0, Math.max(0, capacity)) : jobs;
  const nights = jobs.length === 0 ? 0 : Number.isFinite(capacity) && capacity > 0 ? Math.ceil(jobs.length / capacity) : 1;
  return { jobs: tonight, total: jobs.length, missing: missing.length, stale: stale.length, fresh, nights };
}

// ------------------------------------------------------------- fetchers
const http = axios.create({ timeout: 20000, validateStatus: () => true });
const tenYearsAgo = (now) => isoDay(now - HISTORY_YEARS * 365.25 * DAY);
const quotaError = (msg) => Object.assign(new Error(msg), { quota: true });
const deadError = (msg) => Object.assign(new Error(msg), { dead: true });

// TwelveData's free plan has two limits: 8 credits a minute and 800 a day.
// The minute one is shared with the live site's calls on the same key, so
// "run out of API credits for the current minute" means wait the minute out
// (TD_MINUTE_RETRIES times at most); only the day's limit ends the night.
export const TD_MINUTE_RETRIES = 3;
const minuteLimit = (msg) => /current minute|per minute/i.test(msg);

export async function twelveDataSeries(symbol, from, { now = Date.now(), get = tdGet, wait = sleep } = {}) {
  let d;
  for (let n = 0; ; n++) {
    try {
      d = await get('/time_series', { symbol, interval: '1day', outputsize: 5000, start_date: from || tenYearsAgo(now), order: 'ASC' });
      break;
    } catch (e) {
      const msg = String(e.message || e);
      if (minuteLimit(msg) && n < TD_MINUTE_RETRIES) {
        await wait(61000);
        continue;
      }
      if (/run out|limit|credits|429/i.test(msg)) throw quotaError(msg);
      if (/not found|invalid|symbol|400/i.test(msg)) return null;
      throw e;
    }
  }
  const vals = d?.values || [];
  const out = vals.map((v) => ({ date: String(v.datetime).slice(0, 10), close: Number(v.close) })).filter((v) => Number.isFinite(v.close));
  return out.length ? out : null;
}

// The last close from Finnhub's quote: [{ date, close }] — one row, merged
// into the stored series by the build. null for a symbol it does not price
// (a zero quote, or a 403 for a listing the plan does not cover); throws on
// the quota, on a bad key (401), and after FINNHUB_REFUSALS_IN_A_ROW 403s
// with no answer between them (the account, not the symbols).
export const FINNHUB_REFUSALS_IN_A_ROW = 10;
let refusedInARow = 0;
let refusedTotal = 0;
export const finnhubRefusals = () => refusedTotal;
export const resetFinnhubRefusals = () => {
  refusedInARow = 0;
  refusedTotal = 0;
};

// 429 is Finnhub's per-minute limit (shared with the live site's calls on the
// same key), not a daily one: wait the minute out and ask again, and give
// up for the night only after FINNHUB_429_RETRIES waits in a row.
export const FINNHUB_429_RETRIES = 3;

export async function finnhubQuote(symbol, _from, { get = (url, opts) => http.get(url, opts), wait = sleep } = {}) {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) throw new Error('FINNHUB_API_KEY not set');
  let r = await get('https://finnhub.io/api/v1/quote', { params: { symbol, token: key } });
  for (let n = 0; r.status === 429 && n < FINNHUB_429_RETRIES; n++) {
    await wait(61000);
    r = await get('https://finnhub.io/api/v1/quote', { params: { symbol, token: key } });
  }
  if (r.status === 401) throw deadError('Finnhub quote: key refused (HTTP 401)');
  if (r.status === 403) {
    refusedInARow++;
    refusedTotal++;
    if (refusedInARow >= FINNHUB_REFUSALS_IN_A_ROW) throw deadError(`Finnhub quote: refused (HTTP 403) ${refusedInARow} times in a row`);
    return null;
  }
  if (r.status === 429) throw quotaError(`Finnhub HTTP 429 after ${FINNHUB_429_RETRIES} one-minute waits`);
  if (r.status !== 200) throw new Error(`Finnhub HTTP ${r.status}`);
  refusedInARow = 0;
  const c = Number(r.data?.c);
  const t = Number(r.data?.t);
  if (!(c > 0) || !(t > 0)) return null;
  return [{ date: isoDay(t * 1000), close: c }];
}

// The providers a run can use, with tonight's budget and the pause between
// calls. Budget 0 turns one off; a missing key does too.
export function providerPlan(env = process.env) {
  const n = (k, dflt) => (env[k] === undefined || env[k] === '' ? dflt : Number(env[k]));
  return [
    { name: 'twelvedata', enabled: hasTd(), budget: n('PRICES_TD_BUDGET', 400), pauseMs: 7600, concurrency: 1, fetch: twelveDataSeries },
    // a quote only extends a series: symbols with no history wait for TwelveData
    { name: 'finnhub', enabled: hasFinnhub(), budget: n('PRICES_FINNHUB_BUDGET', 2400), pauseMs: 1050, concurrency: 1, fetch: finnhubQuote, appendOnly: true },
  ].filter((p) => p.enabled && p.budget > 0);
}

// ---------------------------------------------------------------- build
// Runs the plan through the providers in order: every job is offered to the
// first provider with budget left; what it does not know or could not serve
// moves to the next. A provider that answers "quota" or "not on this plan"
// is out for the night. Returns the tally the log and the index carry.
export async function buildPrices({
  root = process.cwd(),
  log = console.log,
  now = Date.now(),
  providers = providerPlan(),
  maxAgeDays = Number(process.env.PRICES_MAX_AGE_DAYS || 1),
  dryRun = process.env.PRICES_DRY === '1',
} = {}) {
  const read = (rel) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
    } catch {
      return null;
    }
  };
  const guruStocks = read('api/_data/guru-stocks.json');
  if (!guruStocks?.stocks) throw new Error('api/_data/guru-stocks.json is missing — run build-consensus.mjs first');

  const symbols = universeSymbols({ guruStocks, insiderTickers: recentInsiderTickers(read('api/_data/insiders.json')) });
  const index = seriesIndex();
  // every job is offered to the providers in turn, each within its own
  // budget: history (TwelveData) for the symbols without one, then the last
  // close (Finnhub) for the series already on file
  const plan = planFetch(symbols, index, { now, maxAgeDays });
  const historyBudget = providers.filter((p) => !p.appendOnly).reduce((s, p) => s + p.budget, 0);
  const quoteBudget = providers.filter((p) => p.appendOnly).reduce((s, p) => s + p.budget, 0);
  plan.nights = plan.missing === 0 ? 0 : historyBudget > 0 ? Math.max(1, Math.ceil(plan.missing / historyBudget)) : Infinity;
  log(
    `price cache: ${symbols.length} symbols in the universe, ${index.size} on file — ${plan.missing} without a history, ${plan.stale} stale (> ${maxAgeDays}d), ${plan.fresh} fresh; ` +
      `tonight through ${providers.map((p) => `${p.name} (${p.budget}${p.appendOnly ? ', last close only' : ''})`).join(' → ') || 'no provider'}; ` +
      `histories for every symbol in ${Number.isFinite(plan.nights) ? `${plan.nights} night${plan.nights === 1 ? '' : 's'}` : 'never (no history provider)'}` +
      (quoteBudget ? `; ${Math.min(plan.stale, quoteBudget)} of ${plan.stale} stale series get tonight's close` : '')
  );
  if (!providers.length) log('  no price provider is enabled (no TWELVEDATA/FINNHUB key) — nothing fetched');
  if (dryRun) return { plan, written: 0, unknown: 0, failed: 0, bySource: {}, dryRun: true };

  const tally = { written: 0, unknown: 0, failed: 0, bySource: {} };
  let pending = plan.jobs;
  for (const p of providers) {
    if (!pending.length) break;
    const leftover = [];
    let queue = pending;
    if (p.appendOnly) {
      queue = pending.filter((j) => j.from);
      leftover.push(...pending.filter((j) => !j.from));
    }
    const mine = queue.slice(0, Number.isFinite(p.budget) ? p.budget : queue.length);
    let spent = 0;
    let out = false;
    let ok = 0;
    let unknownHere = 0;
    let i = 0;
    const worker = async () => {
      while (i < mine.length && !out) {
        const job = mine[i++];
        spent++;
        try {
          const series = await p.fetch(job.symbol, job.from, { now });
          noteProvider(p.name, { ok: true });
          if (series === null) {
            unknownHere++;
            leftover.push(job);
          } else {
            const have = job.from ? readSeries(job.symbol)?.prices || [] : [];
            writeSeries(job.symbol, have.length ? mergeSeries(have, series) : series, { src: p.name, now });
            ok++;
          }
        } catch (e) {
          leftover.push(job);
          noteProvider(p.name, { error: e.message });
          if (e.quota || e.dead) {
            out = true;
            log(`  ${p.name}: ${e.message} — done for tonight after ${spent} calls`);
          } else {
            tally.failed++;
          }
        }
        if (p.pauseMs) await sleep(p.pauseMs);
      }
    };
    await Promise.all(Array.from({ length: Math.min(p.concurrency || 1, mine.length) }, worker));
    // jobs the provider never reached (budget or an early exit) go on too
    const reached = new Set(mine.slice(0, Math.min(i, mine.length)).map((j) => j.symbol));
    for (const job of mine) if (!reached.has(job.symbol)) leftover.push(job);
    tally.written += ok;
    tally.bySource[p.name] = ok;
    log(`  ${p.name}: ${ok} series written, ${unknownHere} unknown to it, ${spent} calls`);
    const seen = new Set();
    pending = [...leftover, ...queue.slice(mine.length)].filter((j) => !seen.has(j.symbol) && seen.add(j.symbol));
  }
  tally.unknown = pending.length;
  log(`price cache: ${tally.written} series written tonight, ${pending.length} left for another night, ${tally.failed} transient failures`);

  // ---- the index the audit and /api/diag read ----
  const after = seriesIndex();
  let oldest = null;
  let newest = null;
  const bySrc = {};
  for (const e of after.values()) {
    if (!oldest || e.asOf < oldest) oldest = e.asOf;
    if (!newest || e.asOf > newest) newest = e.asOf;
    bySrc[e.src || 'unknown'] = (bySrc[e.src || 'unknown'] || 0) + 1;
  }
  const covered = symbols.filter((s) => after.has(seriesKey(s))).length;
  const summary = {
    updatedAt: new Date(now).toISOString(),
    count: after.size,
    universe: symbols.length,
    covered,
    coveragePct: symbols.length ? Number(((covered / symbols.length) * 100).toFixed(1)) : 0,
    oldestAsOf: oldest,
    newestAsOf: newest,
    bySource: bySrc,
    tonight: { jobs: plan.jobs.length, written: tally.written, leftover: pending.length, nightsToFill: plan.nights },
  };
  fs.mkdirSync(pricesDir(), { recursive: true });
  fs.writeFileSync(path.join(pricesDir(), '_index.json'), JSON.stringify(summary));
  log(`price cache: ${covered}/${symbols.length} of the universe on file (${summary.coveragePct}%), closes ${oldest} … ${newest}`);

  // ---- the return columns, from the same closes ----
  const returnsFile = read('client/public/returns.json');
  if (returnsFile?.returns) {
    let refreshed = 0;
    const today = isoDay(now);
    for (const [key, e] of after) {
      const have = returnsFile.returns[key];
      if (have?.asOf && have.asOf >= e.asOf) continue;
      const s = readSeries(key);
      if (!s) continue;
      const r = returnsFromSeries(key, s.prices, now);
      if (r.ret1y == null && r.retYtd == null) continue;
      const round = (x) => (x == null ? null : Number(x.toFixed(2)));
      returnsFile.returns[key] = { ret1y: round(r.ret1y), retYtd: round(r.retYtd), ret1d: round(r.ret1d), asOf: r.asOf || today };
      refreshed++;
    }
    if (refreshed) {
      fs.writeFileSync(path.join(root, 'client/public/returns.json'), JSON.stringify({ ...returnsFile, updatedAt: new Date(now).toISOString() }));
      log(`returns.json: ${refreshed} rows refreshed from the price cache`);
    }
  }
  return { plan, ...tally, summary };
}

// The last close for symbols whose stored series is behind, from Finnhub's
// quote, within `budget` calls (the insider build: the tickers traded today
// that the nightly price build has not reached). Missing series first, then
// the oldest. Returns { asked, written, unknown }.
// `missingOnly`: only symbols with no file at all — the nightly price build
// keeps the stored series current, and Finnhub's per-minute limit is shared
// with it and with the live site (1,200 calls here took 50 minutes on 3 Oct).
export async function topUpCloses(symbols, { budget = 0, now = Date.now(), maxAgeDays = 1, log = console.log, quote = finnhubQuote, pauseMs = 1050, missingOnly = false } = {}) {
  if (!(budget > 0) || !hasFinnhub()) return { asked: 0, written: 0, unknown: 0 };
  const index = seriesIndex();
  const listed = symbols.filter(listedTicker).filter((s) => !missingOnly || !index.has(seriesKey(s)));
  const plan = planFetch(listed, index, { now, maxAgeDays, capacity: budget });
  let written = 0;
  let unknown = 0;
  let asked = 0;
  for (const job of plan.jobs) {
    asked++;
    try {
      const rows = await quote(job.symbol);
      noteProvider('finnhub', { ok: true });
      if (!rows) unknown++;
      else {
        const have = readSeries(job.symbol)?.prices || [];
        writeSeries(job.symbol, have.length ? mergeSeries(have, rows) : rows, { src: have.length ? readSeries(job.symbol)?.src || 'finnhub' : 'finnhub', now });
        written++;
      }
    } catch (e) {
      noteProvider('finnhub', { error: e.message });
      if (e.quota || e.dead) {
        log(`  finnhub: ${e.message} — stopping after ${asked} calls`);
        break;
      }
    }
    if (pauseMs) await sleep(pauseMs);
  }
  log(`  closes topped up: ${written} of ${plan.jobs.length} asked (${plan.missing} without a series, ${plan.stale} behind), ${unknown} unknown to Finnhub`);
  return { asked, written, unknown };
}
