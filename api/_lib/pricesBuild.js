// The nightly price build: which symbols need a series, from where, within
// which quota — and the fetchers, one per provider, each answering
// [{date, close}] ascending, null for a symbol the provider does not know,
// and throwing for anything transient. The planning is pure and tested; the
// fetchers are thin. scripts/build-prices.mjs is the entry point.
//
// Sources, in the order they are asked:
//   yahoo       chart v8 from a GitHub runner — no key, no daily quota, ten
//               years in one request. It answers from runners (the nightly
//               return columns come from it today) and 429s Vercel, which is
//               why it is a build source here and not in the live chain.
//   twelvedata  /time_series, 5000 rows a call, 800 credits a day and 8 a
//               minute on the free plan (a batch call is one credit per
//               symbol, so batching buys nothing): the build paces at the
//               minute limit and spends PRICES_TD_BUDGET a night.
//   fmp         /historical-price-eod/light, 250 a day shared with the live
//               quote board: a small slice.
//   finnhub     /stock/candle — off the free plan since 2024 (403); asked
//               once a run and dropped for the night on a 403.
import axios from 'axios';
import fs from 'node:fs';
import path from 'node:path';
import { fmpGet, tdGet, hasFmp, hasTd, hasFinnhub } from './providers.js';
import { readSeries, writeSeries, seriesIndex, seriesKey, seriesAgeDays, mergeSeries, returnsFromSeries, pricesDir } from './priceStore.js';

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
export function universeSymbols({ guruStocks } = {}) {
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
  return out;
}

// What tonight fetches, in order: symbols with no series at all (in
// universe order, so the most-held names land first), then series whose
// last close is older than `maxAgeDays` (oldest first). A series fresh
// enough is left alone. `capacity` is the calls the night can spend; the
// plan says how many nights the whole universe needs at that rate.
export function planFetch(symbols, index, { now = Date.now(), maxAgeDays = 1, capacity = Infinity } = {}) {
  const missing = [];
  const stale = [];
  let fresh = 0;
  for (const sym of symbols) {
    const have = index.get(seriesKey(sym));
    if (!have?.asOf) missing.push({ symbol: sym, from: null, reason: 'missing' });
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

export async function yahooSeries(symbol, from, { now = Date.now() } = {}) {
  const period1 = Math.floor(Date.parse(`${from || tenYearsAgo(now)}T00:00:00Z`) / 1000);
  const period2 = Math.floor(now / 1000);
  const r = await http.get(`https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`, {
    params: { period1, period2, interval: '1d' },
    headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
  });
  if (r.status === 404 || r.status === 400) return null;
  if (r.status === 429) throw quotaError('Yahoo HTTP 429');
  if (r.status !== 200) throw new Error(`Yahoo HTTP ${r.status}`);
  const result = r.data?.chart?.result?.[0];
  const ts = result?.timestamp || [];
  const closes = result?.indicators?.quote?.[0]?.close || [];
  const out = [];
  for (let i = 0; i < ts.length; i++) if (closes[i] != null && Number.isFinite(closes[i])) out.push({ date: isoDay(ts[i] * 1000), close: closes[i] });
  return out.length ? out : null;
}

export async function twelveDataSeries(symbol, from, { now = Date.now() } = {}) {
  let d;
  try {
    d = await tdGet('/time_series', { symbol, interval: '1day', outputsize: 5000, start_date: from || tenYearsAgo(now), order: 'ASC' });
  } catch (e) {
    const msg = String(e.message || e);
    if (/run out|limit|credits|429/i.test(msg)) throw quotaError(msg);
    if (/not found|invalid|symbol|400/i.test(msg)) return null;
    throw e;
  }
  const vals = d?.values || [];
  const out = vals.map((v) => ({ date: String(v.datetime).slice(0, 10), close: Number(v.close) })).filter((v) => Number.isFinite(v.close));
  return out.length ? out : null;
}

export async function fmpSeries(symbol, from, { now = Date.now() } = {}) {
  let d;
  try {
    d = await fmpGet('/historical-price-eod/light', symbol, '/historical-price-full', { from: from || tenYearsAgo(now), to: isoDay(now), serietype: 'line' });
  } catch (e) {
    const msg = String(e.message || e);
    if (/429|limit/i.test(msg)) throw quotaError(msg);
    if (/empty|not found/i.test(msg)) return null;
    throw e;
  }
  const hist = Array.isArray(d) ? d : d?.historical || [];
  const out = hist.map((h) => ({ date: h.date, close: Number(h.close ?? h.price) })).filter((h) => Number.isFinite(h.close));
  return out.length ? out : null;
}

export async function finnhubSeries(symbol, from, { now = Date.now() } = {}) {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) throw new Error('FINNHUB_API_KEY not set');
  const r = await http.get('https://finnhub.io/api/v1/stock/candle', {
    params: { symbol, resolution: 'D', from: Math.floor(Date.parse(`${from || tenYearsAgo(now)}T00:00:00Z`) / 1000), to: Math.floor(now / 1000), token: key },
  });
  if (r.status === 403) throw deadError('Finnhub candles: not on this plan (HTTP 403)');
  if (r.status === 429) throw quotaError('Finnhub HTTP 429');
  if (r.status !== 200) throw new Error(`Finnhub HTTP ${r.status}`);
  if (r.data?.s !== 'ok') return null;
  const out = [];
  for (let i = 0; i < (r.data.t || []).length; i++) if (Number.isFinite(r.data.c[i])) out.push({ date: isoDay(r.data.t[i] * 1000), close: r.data.c[i] });
  return out.length ? out : null;
}

// The providers a run can use, with tonight's budget and the pause between
// calls. Budget 0 turns one off; a missing key does too.
export function providerPlan(env = process.env) {
  const n = (k, dflt) => (env[k] === undefined || env[k] === '' ? dflt : Number(env[k]));
  return [
    { name: 'yahoo', enabled: env.PRICES_YAHOO !== '0', budget: n('PRICES_YAHOO_BUDGET', Infinity), pauseMs: 250, concurrency: 4, fetch: yahooSeries },
    { name: 'twelvedata', enabled: hasTd(), budget: n('PRICES_TD_BUDGET', 400), pauseMs: 7600, concurrency: 1, fetch: twelveDataSeries },
    { name: 'fmp', enabled: hasFmp(), budget: n('PRICES_FMP_BUDGET', 60), pauseMs: 300, concurrency: 1, fetch: fmpSeries },
    { name: 'finnhub', enabled: hasFinnhub(), budget: n('PRICES_FINNHUB_BUDGET', 300), pauseMs: 1100, concurrency: 1, fetch: finnhubSeries },
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

  const symbols = universeSymbols({ guruStocks });
  const index = seriesIndex();
  const capacity = providers.reduce((s, p) => s + p.budget, 0);
  const plan = planFetch(symbols, index, { now, maxAgeDays, capacity });
  log(
    `price cache: ${symbols.length} symbols in the universe, ${index.size} on file — ${plan.missing} missing, ${plan.stale} stale (> ${maxAgeDays}d), ${plan.fresh} fresh; ` +
      `tonight: ${plan.jobs.length} of ${plan.total} jobs through ${providers.map((p) => `${p.name}${Number.isFinite(p.budget) ? ` (${p.budget})` : ''}`).join(' → ') || 'no provider'}; ` +
      `full fill at this rate: ${plan.nights} night${plan.nights === 1 ? '' : 's'}`
  );
  if (!providers.length) log('  no price provider is enabled (Yahoo off, no TWELVEDATA/FMP/FINNHUB key) — nothing fetched');
  if (dryRun) return { plan, written: 0, unknown: 0, failed: 0, bySource: {}, dryRun: true };

  const tally = { written: 0, unknown: 0, failed: 0, bySource: {} };
  let pending = plan.jobs;
  for (const p of providers) {
    if (!pending.length) break;
    const mine = pending.slice(0, Number.isFinite(p.budget) ? p.budget : pending.length);
    const leftover = [];
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
    pending = [...leftover, ...pending.slice(mine.length)].filter((j) => !seen.has(j.symbol) && seen.add(j.symbol));
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
