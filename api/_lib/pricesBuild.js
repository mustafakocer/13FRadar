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
import { readSeries, readSeriesRaw, writeSeries, seriesIndex, seriesKey, seriesAgeDays, mergeSeries, returnsFromSeries, pricesDir, lastBreak, verifiedThrough } from './priceStore.js';
import { returnsCutoff } from './stockMetaBuild.js';
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

// ------------------------------------------------------------- rebase
// A series with a split-sized break after its verified history
// (priceStore.js) is fetched again whole: the history provider answers it
// in today's shares. These jobs go first — a wrong series costs more than a
// missing one — and carry what the settling needs:
//   breakPrev / breakDate   the two rows the break sits between
//   stale                   the series also needs tonight's close
// A provider that still shows the same move may not have booked the split
// yet, so the answer is believed on the REBASE_TRIES-th night: until then
// the series stays unverified (readers keep getting it from the break on).
// A symbol no history provider knows is cut at the break for good on that
// same night — closes that cannot be restated are not kept beside ones in
// other shares; until then every row stays in the file.
export const REBASE_TRIES = 2;

export function rebaseJobs(index, { symbols = [], now = Date.now(), maxAgeDays = 1, read = readSeriesRaw } = {}) {
  const asked = new Map(symbols.map((sym) => [seriesKey(sym), sym]));
  const jobs = [];
  for (const [key, e] of index) {
    // only the tail is unverified: skip the decode when nothing was appended
    if (e.hist && e.hist >= e.asOf) continue;
    const s = read(key);
    const i = s ? lastBreak(s.prices, verifiedThrough(s)) : -1;
    if (i <= 0) continue;
    jobs.push({ symbol: asked.get(key) || s.symbol || key, from: null, reason: 'rebase', breakPrev: s.prices[i - 1].date, breakDate: s.prices[i].date, asOf: s.asOf, stale: seriesAgeDays(s.asOf, now) > maxAgeDays });
  }
  return jobs;
}

// A history just fetched for a rebase job → what to write.
//   { prices, hist, rb, fixed }  fixed: the break is gone (or believed)
export function settleRebase(job, have, series) {
  const last = series[series.length - 1].date;
  // closes stored after the provider's last bar are post-break quotes, in the
  // same shares as the adjusted history: kept
  const tail = last >= job.breakPrev ? (have?.prices || []).filter((p) => p.date > last) : [];
  const prices = tail.length ? mergeSeries(series, tail) : series;
  const i = lastBreak(prices, isoDay(Date.parse(`${job.breakPrev}T00:00:00Z`) - 7 * DAY));
  const tries = (have?.rb || 0) + 1;
  if (i > 0 && tries < REBASE_TRIES) return { prices, hist: prices[i - 1].date, rb: tries, fixed: false };
  return { prices, hist: prices[prices.length - 1].date, rb: 0, fixed: true };
}

// The same day in the stored series and in a provider's answer, more than a
// fifth apart: the provider restated its history (a 2-for-1, a 3-for-2 —
// splits too small for lastBreak), so the answer cannot be appended.
export function restated(have, series) {
  if (!have?.length || !series?.length) return false;
  const byDate = new Map(series.map((p) => [p.date, p.close]));
  for (let i = have.length - 1; i >= 0 && have[i].date >= series[0].date; i--) {
    const c = byDate.get(have[i].date);
    if (c > 0) return Math.abs(c / have[i].close - 1) > 0.2;
  }
  return false;
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

// One Finnhub key serves the nightly price build, the insider build and the
// live site; the free plan allows 60 calls a minute. The two builds never
// call it at once (scripts/finnhub-peer.mjs) and each paces at
// FINNHUB_JOB_PER_MIN, leaving the rest of the minute to the live site.
export const FINNHUB_JOB_PER_MIN = 50;
export const FINNHUB_PAUSE_MS = Math.ceil(60000 / FINNHUB_JOB_PER_MIN);
// 429 is the per-minute limit, not a daily one: wait the minute out and ask
// again; FINNHUB_429_IN_A_ROW of them with no answer between end the run.
export const FINNHUB_429_IN_A_ROW = 10;
export const FINNHUB_429_WAIT_MS = 61000;
const fhStats = { calls: 0, throttled: 0, waitedMs: 0 };
let throttledInARow = 0;
export const finnhubStats = () => ({ ...fhStats });
export const resetFinnhubStats = () => {
  fhStats.calls = 0;
  fhStats.throttled = 0;
  fhStats.waitedMs = 0;
  throttledInARow = 0;
};
// The run summary line both builds print and write to the step summary.
// TwelveData's /api_usage answer as two log lines. current_usage/plan_limit
// is the per-minute counter (8 on the free plan); the day's 800 credits are
// daily_usage/plan_daily_limit. The first is what the night has to go on.
export function tdUsageLines(u) {
  const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null);
  const dUsed = num(u?.daily_usage);
  const dLimit = num(u?.plan_daily_limit);
  const mUsed = num(u?.current_usage);
  const mLimit = num(u?.plan_limit);
  const at = u?.timestamp ? ` (${u.timestamp})` : '';
  const daily = dUsed !== null && dLimit !== null
    ? `twelvedata credits before tonight: ${dUsed} of ${dLimit} daily credits used, ${Math.max(0, dLimit - dUsed)} left${at}`
    : `twelvedata credits before tonight: daily counter not reported${at}`;
  const minute = mUsed !== null && mLimit !== null
    ? `twelvedata minute counter: ${mUsed} of ${mLimit} per minute`
    : 'twelvedata minute counter: not reported';
  return [daily, minute];
}

export function finnhubSummary(label) {
  const s = finnhubStats();
  const line = `${label}: Finnhub ${s.calls} request(s), ${s.throttled} × 429, ${Math.round(s.waitedMs / 1000)} s waited`;
  console.log(line);
  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `- ${line}\n`);
    } catch {
      /* the summary is a nicety */
    }
  }
  return line;
}

export async function finnhubQuote(symbol, _from, { get = (url, opts) => http.get(url, opts), wait = sleep } = {}) {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) throw new Error('FINNHUB_API_KEY not set');
  const ask = () => {
    fhStats.calls++;
    return get('https://finnhub.io/api/v1/quote', { params: { symbol, token: key } });
  };
  let r = await ask();
  while (r.status === 429) {
    fhStats.throttled++;
    throttledInARow++;
    if (throttledInARow >= FINNHUB_429_IN_A_ROW) throw quotaError(`Finnhub HTTP 429 ${throttledInARow} times in a row`);
    fhStats.waitedMs += FINNHUB_429_WAIT_MS;
    await wait(FINNHUB_429_WAIT_MS);
    r = await ask();
  }
  throttledInARow = 0;
  if (r.status === 401) throw deadError('Finnhub quote: key refused (HTTP 401)');
  if (r.status === 403) {
    refusedInARow++;
    refusedTotal++;
    if (refusedInARow >= FINNHUB_REFUSALS_IN_A_ROW) throw deadError(`Finnhub quote: refused (HTTP 403) ${refusedInARow} times in a row`);
    return null;
  }
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
    { name: 'finnhub', enabled: hasFinnhub(), budget: n('PRICES_FINNHUB_BUDGET', 2400), pauseMs: FINNHUB_PAUSE_MS, concurrency: 1, fetch: finnhubQuote, appendOnly: true },
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
  // series with an unverified split-sized break: their history, first
  const rebase = rebaseJobs(index, { symbols, now, maxAgeDays });
  if (rebase.length) {
    const first = new Set(rebase.map((j) => seriesKey(j.symbol)));
    plan.jobs = [...rebase, ...plan.jobs.filter((j) => !first.has(seriesKey(j.symbol)))];
    log(`price cache: ${rebase.length} series with a split-sized break since their last full history — fetched again whole first: ${rebase.slice(0, 40).map((j) => `${j.symbol} (${j.breakDate})`).join(', ')}${rebase.length > 40 ? ', …' : ''}`);
  }
  plan.rebase = rebase.length;
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

  const tally = { written: 0, unknown: 0, failed: 0, bySource: {}, rebased: 0, unsettled: 0, cut: 0 };
  // keys whose history changed tonight: their return row is recomputed
  const restatedKeys = new Set();
  const history = (job, series, p) => {
    const have = readSeriesRaw(job.symbol);
    if (job.reason !== 'rebase') {
      writeSeries(job.symbol, series, { src: p.name, now, hist: series[series.length - 1].date });
      if (have) restatedKeys.add(seriesKey(job.symbol));
      return;
    }
    const r = settleRebase(job, have, series);
    writeSeries(job.symbol, r.prices, { src: p.name, now, hist: r.hist, rb: r.rb });
    job.settled = true;
    restatedKeys.add(seriesKey(job.symbol));
    if (r.fixed) tally.rebased++;
    else tally.unsettled++;
  };
  let pending = plan.jobs;
  for (const p of providers) {
    if (!pending.length) break;
    const leftover = [];
    let queue = pending;
    if (p.appendOnly) {
      // a rebase job no history provider settled still wants tonight's close
      const appendable = (j) => j.from || (j.reason === 'rebase' && j.stale && !j.settled);
      queue = pending.filter(appendable);
      leftover.push(...pending.filter((j) => !appendable(j)));
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
            if (job.reason === 'rebase' && !p.appendOnly) job.unknown = true;
            leftover.push(job);
          } else if (!p.appendOnly && !job.from) {
            history(job, series, p);
            ok++;
          } else {
            const have = readSeriesRaw(job.symbol);
            if (!have?.prices?.length) {
              writeSeries(job.symbol, series, { src: p.name, now, ...(p.appendOnly ? {} : { hist: series[series.length - 1].date }) });
            } else if (!p.appendOnly && restated(have.prices, series)) {
              // the provider's history is in other shares than the file's:
              // take it whole instead of joining the two
              spent++;
              const whole = await p.fetch(job.symbol, null, { now });
              if (whole === null) throw new Error(`${job.symbol}: history restated, the whole series did not come back`);
              history({ ...job, from: null }, whole, p);
            } else {
              // an append: `hist` stays where the last whole history left it,
              // unless this provider's own rows overlap the file and agree
              const joined = !p.appendOnly && series[0].date <= have.asOf;
              writeSeries(job.symbol, mergeSeries(have.prices, series), { src: p.name, now, hist: joined ? series[series.length - 1].date : have.hist, rb: have.rb });
            }
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
  // rebase jobs the history provider does not know: counted, and after
  // REBASE_TRIES nights cut at the break
  for (const job of rebase) {
    if (!job.unknown || job.settled) continue;
    const have = readSeriesRaw(job.symbol);
    const i = have ? lastBreak(have.prices, verifiedThrough(have)) : -1;
    if (i <= 0) continue;
    const tries = (have.rb || 0) + 1;
    if (tries < REBASE_TRIES) {
      writeSeries(job.symbol, have.prices, { src: have.src, now, hist: have.hist, rb: tries });
    } else {
      writeSeries(job.symbol, have.prices.slice(i), { src: have.src, now, hist: have.asOf });
      restatedKeys.add(seriesKey(job.symbol));
      tally.cut++;
    }
  }
  if (plan.rebase) log(`price cache: of ${plan.rebase} series with a break — ${tally.rebased} restated, ${tally.unsettled} still showing it (asked again tomorrow), ${tally.cut} cut at the break (no provider has their history)`);
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
  // series readers still get from a break on (not settled tonight), for the audit
  const unverified = [];
  for (const [key, e] of after) {
    if (e.hist && e.hist >= e.asOf) continue;
    const s = readSeries(key);
    if (s?.held) unverified.push({ key, since: s.from });
  }
  unverified.sort((a, b) => (a.since < b.since ? -1 : a.since > b.since ? 1 : 0));
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
    tonight: { jobs: plan.jobs.length, written: tally.written, leftover: pending.length, nightsToFill: plan.nights, rebased: tally.rebased, cut: tally.cut },
    unverified: { count: unverified.length, oldest: unverified[0]?.since || null, symbols: unverified.slice(0, 20).map((u) => u.key) },
  };
  fs.mkdirSync(pricesDir(), { recursive: true });
  fs.writeFileSync(path.join(pricesDir(), '_index.json'), JSON.stringify(summary));
  log(`price cache: ${covered}/${symbols.length} of the universe on file (${summary.coveragePct}%), closes ${oldest} … ${newest}`);

  // ---- the return columns, from the same closes ----
  // A row whose last close is past the shelf life (stockMetaBuild.js
  // mergeReturns: a security that stopped trading) goes, rather than being
  // rewritten every night with its final close as "today's".
  const returnsFile = read('client/public/returns.json');
  if (returnsFile?.returns) {
    let refreshed = 0;
    let dropped = 0;
    const today = isoDay(now);
    const cutoff = returnsCutoff(now);
    for (const [key, e] of after) {
      const have = returnsFile.returns[key];
      if (e.asOf && e.asOf < cutoff) {
        if (have) {
          delete returnsFile.returns[key];
          dropped++;
        }
        continue;
      }
      const s = readSeries(key);
      if (!s) continue;
      // an unverified break: the closes before it are withheld, so there is
      // no return to state — and the row on file was computed across it
      if (s.held) {
        if (have) {
          delete returnsFile.returns[key];
          dropped++;
        }
        continue;
      }
      if (have?.asOf && have.asOf >= e.asOf && !restatedKeys.has(key)) continue;
      const r = returnsFromSeries(key, s.prices, now);
      if (r.ret1y == null && r.retYtd == null) continue;
      const round = (x) => (x == null ? null : Number(x.toFixed(2)));
      returnsFile.returns[key] = { ret1y: round(r.ret1y), retYtd: round(r.retYtd), ret1d: round(r.ret1d), asOf: r.asOf || today };
      refreshed++;
    }
    for (const [key, have] of Object.entries(returnsFile.returns)) {
      if (have?.asOf && have.asOf < cutoff) {
        delete returnsFile.returns[key];
        dropped++;
      }
    }
    if (refreshed || dropped) {
      fs.writeFileSync(path.join(root, 'client/public/returns.json'), JSON.stringify({ ...returnsFile, updatedAt: new Date(now).toISOString() }));
      log(`returns.json: ${refreshed} rows refreshed from the price cache, ${dropped} dropped (last close before ${cutoff}, or an unverified split-sized break)`);
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
export async function topUpCloses(symbols, { budget = 0, now = Date.now(), maxAgeDays = 1, log = console.log, quote = finnhubQuote, pauseMs = FINNHUB_PAUSE_MS, missingOnly = false } = {}) {
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
        // the whole file, not the reader's view: an append must not drop
        // the rows a break withholds, nor the file's verified-through date
        const have = readSeriesRaw(job.symbol);
        writeSeries(job.symbol, have?.prices?.length ? mergeSeries(have.prices, rows) : rows, { src: have?.prices?.length ? have.src || 'finnhub' : 'finnhub', now, hist: have?.hist || null, rb: have?.rb || 0 });
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
