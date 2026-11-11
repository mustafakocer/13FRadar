// The nightly price cache: ten years of daily closes for every symbol the
// curated funds hold plus the benchmarks, one small file per symbol under
// api/_data/prices/, written by scripts/build-prices.mjs and read by
// dailyCloses() (api/_lib/providers.js) before any live provider is asked.
//
// Why a file per symbol: the backtest wants a handful of series per request
// and a chart wants one, so reading only those is a few synchronous file
// reads; one 50 MB file would be parsed whole on every cold start. Why the
// compact shape: 1,900 symbols × 2,500 rows as [{date, close}] is 100 MB of
// JSON in the repository and in the function bundle. Dates are stored as
// day gaps from the previous row (1 on a weekday, 3 over a weekend) and
// closes with the precision a price needs, which is a fifth of that — and
// still plain text, so a night's append is a small diff for git.
//
//   { symbol, src, from, asOf, updatedAt, hist, rb, d: [gap, gap, …], c: [close, …] }
//
// `hist` is the date up to which the closes are known to be in one unit: the
// last close of the newest history a provider answered whole (its history is
// split-adjusted). Closes appended after it are single quotes, in whatever
// shares the security traded in that day — see "split-sized breaks" below.
// `rb` counts the nights a break was re-checked and still stood.
//
// PRICES_DIR points the store somewhere else (tests, a dry run).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const pricesDir = () => process.env.PRICES_DIR || path.join(here, '..', '_data', 'prices');

// The file name a symbol lives under: BRK.B and BRK-B are one security and
// one file; anything that is not a letter or digit becomes a dash.
export const seriesKey = (symbol) =>
  String(symbol || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const DAY = 86400 * 1000;
const parseDay = (iso) => Date.parse(`${iso}T00:00:00Z`);
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

// A close keeps two decimals from ten dollars up and four below, which is
// what the exchanges quote; anything beyond that is noise in the file.
export const roundClose = (x) => (x >= 10 ? Number(x.toFixed(2)) : Number(x.toFixed(4)));

// [{date, close}] ascending → the stored shape. Rows out of order or with a
// bad close are dropped rather than written.
export function encodeSeries(prices) {
  const rows = [...prices]
    .filter((p) => p && /^\d{4}-\d{2}-\d{2}$/.test(p.date) && Number.isFinite(p.close) && p.close > 0)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const d = [];
  const c = [];
  let prev = null;
  for (const p of rows) {
    if (p.date === prev) continue; // one row per day, first wins
    d.push(prev == null ? 0 : Math.round((parseDay(p.date) - parseDay(prev)) / DAY));
    c.push(roundClose(p.close));
    prev = p.date;
  }
  return { from: rows.length ? rows[0].date : null, asOf: prev, d, c };
}

// Every series walks the same few thousand calendar days, so the date string
// for a day is formatted once per process rather than once per row: decoding
// the ~1,900 series the insider feed reads on a cold start spent most of its
// CPU in Date#toISOString. Keyed by the day number (UTC midnight / DAY), so
// the cache is bounded by the calendar, not by the number of rows.
const dayStrings = new Map();
const isoDayAt = (t) => {
  const n = Math.round(t / DAY);
  let s = dayStrings.get(n);
  if (s === undefined) {
    s = isoDay(n * DAY);
    dayStrings.set(n, s);
  }
  return s;
};

export function decodeSeries(file) {
  if (!file?.from || !Array.isArray(file.d) || !Array.isArray(file.c)) return [];
  const n = file.d.length;
  const out = new Array(n);
  let t = parseDay(file.from);
  for (let i = 0; i < n; i++) {
    t += file.d[i] * DAY;
    out[i] = { date: isoDayAt(t), close: file.c[i] };
  }
  return out;
}

// Older rows plus newer ones; on the same date the newer answer wins (a
// provider's last bar is the live session until the day closes).
export function mergeSeries(older, newer) {
  const byDate = new Map();
  for (const p of older || []) byDate.set(p.date, p.close);
  for (const p of newer || []) byDate.set(p.date, p.close);
  return [...byDate.entries()]
    .map(([date, close]) => ({ date, close }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

// ------------------------------------------------- split-sized breaks
// A series is a provider's history (split-adjusted on the day it was
// fetched) with one quote appended per night after it. The first quote
// after a share split is in the new shares and everything before it in the
// old: Accuray's 1-for-40 reverse split (9 November 2026) put a $0.11 close
// next to a $3.82 one, and every reader took the pair for a +3,372.73% day —
// about fifty series a quarter, most of them reverse splits of penny stocks.
// A split cannot be told from a real move by the two closes alone, so a
// close SPLIT_JUMP times the one before it (or a third of it), after `hist`,
// is treated as unverified until the history provider has been asked again:
//   · readers get the series from the break on (`held` says how many rows
//     are withheld) — a short series and no return, never a false one;
//   · the nightly build re-fetches the whole history (pricesBuild.js), which
//     comes back adjusted, or with the same move when it was real.
// A file from before `hist` existed is checked over its last
// UNVERIFIED_WINDOW_DAYS days.
export const SPLIT_JUMP = 3;
export const UNVERIFIED_WINDOW_DAYS = 90;
export const splitSized = (a, b) => a > 0 && b > 0 && (b / a >= SPLIT_JUMP || a / b >= SPLIT_JUMP);

// The date through which a series needs no checking.
export const verifiedThrough = ({ hist = null, asOf = null } = {}) => hist || (asOf ? isoDay(parseDay(asOf) - UNVERIFIED_WINDOW_DAYS * DAY) : null);

// Index of the newest row after `after` that is split-sized away from the
// row before it; -1 when the series has none.
export function lastBreak(prices, after = null) {
  for (let i = (prices?.length || 0) - 1; i > 0; i--) {
    if (after && prices[i].date <= after) break;
    if (splitSized(prices[i - 1].close, prices[i].close)) return i;
  }
  return -1;
}

const memo = new Map();
const views = new Map();
export const clearSeriesCache = () => {
  memo.clear();
  views.clear();
};

// Everything on file for a symbol, breaks and all: what the price build
// merges into and writes back. Pages and the other builds read readSeries.
// { symbol, src, from, asOf, updatedAt, hist, rb, prices } or null.
export function readSeriesRaw(symbol) {
  const key = seriesKey(symbol);
  if (!key) return null;
  if (memo.has(key)) return memo.get(key);
  let out = null;
  try {
    const file = JSON.parse(fs.readFileSync(path.join(pricesDir(), `${key}.json`), 'utf8'));
    out = { symbol: file.symbol || key, src: file.src || null, from: file.from, asOf: file.asOf, updatedAt: file.updatedAt || null, hist: file.hist || null, rb: file.rb || 0, prices: decodeSeries(file) };
  } catch {
    out = null;
  }
  memo.set(key, out);
  return out;
}

// { symbol, src, from, asOf, updatedAt, held, prices: [{date, close}] } or
// null when no build has priced the symbol. The closes are in one unit: a
// series with an unverified split-sized break starts at the break (`held`
// rows before it are withheld). Memoised per process: the files only change
// with a deploy (or, in the build, through writeSeries below).
export function readSeries(symbol) {
  const key = seriesKey(symbol);
  if (!key) return null;
  if (views.has(key)) return views.get(key);
  const raw = readSeriesRaw(key);
  let out = raw;
  if (raw) {
    const i = lastBreak(raw.prices, verifiedThrough(raw));
    out = i > 0 ? { ...raw, from: raw.prices[i].date, held: i, prices: raw.prices.slice(i) } : { ...raw, held: 0 };
  }
  views.set(key, out);
  return out;
}

// hist: the date the closes are verified through (see the file shape); rb:
// nights a break was re-checked. Both are dropped from the file when empty.
export function writeSeries(symbol, prices, { src = null, now = Date.now(), hist = null, rb = 0 } = {}) {
  const key = seriesKey(symbol);
  const enc = encodeSeries(prices);
  if (!enc.c.length) return null;
  const dir = pricesDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = { symbol: key, src, from: enc.from, asOf: enc.asOf, updatedAt: new Date(now).toISOString(), ...(hist ? { hist: hist > enc.asOf ? enc.asOf : hist } : {}), ...(rb > 0 ? { rb } : {}), d: enc.d, c: enc.c };
  fs.writeFileSync(path.join(dir, `${key}.json`), JSON.stringify(file));
  memo.delete(key);
  views.delete(key);
  return file;
}

// What the directory holds, without decoding: Map key → { asOf, from, rows, src, hist }.
export function seriesIndex() {
  const dir = pricesDir();
  const out = new Map();
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of names) {
    if (!name.endsWith('.json') || name.startsWith('_')) continue;
    try {
      const file = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
      out.set(name.slice(0, -5), { asOf: file.asOf, from: file.from, rows: file.c?.length || 0, src: file.src || null, hist: file.hist || null });
    } catch {
      /* a half-written file is rebuilt next run */
    }
  }
  return out;
}

// The summary the build writes next to the files (_index.json): how much of
// the universe is on file and how old the closes are. Null before the first
// build.
export function priceCacheStatus() {
  try {
    return JSON.parse(fs.readFileSync(path.join(pricesDir(), '_index.json'), 'utf8'));
  } catch {
    return null;
  }
}

// Days between the series' last close and now; Infinity without a series.
export const seriesAgeDays = (asOf, now = Date.now()) => (asOf ? (now - parseDay(asOf)) / DAY : Infinity);

// {price, ret1y, retYtd, ret1d} from a [{date, close}] series (ascending):
// the return columns the screener and the manager page show.
export function returnsFromSeries(symbol, prices, now = Date.now()) {
  if (!prices?.length) return { symbol, price: null, ret1y: null, retYtd: null, ret1d: null };
  const last = prices[prices.length - 1];
  const price = last.close;
  const yearAgo = isoDay(now - 365 * DAY);
  // A series that starts after the year-ago date (a listing younger than a
  // year) has no 1Y base: its first close would make "1Y" a since-listing
  // return. A week of slack covers a year-ago date that fell on a weekend
  // or holiday.
  const covers1y = prices[0].date <= isoDay(now - 358 * DAY);
  const base1y = covers1y ? prices.find((p) => p.date >= yearAgo) : null;
  const jan1 = `${new Date(now).getUTCFullYear()}-01-01`;
  let baseYtd = null;
  for (let i = prices.length - 1; i >= 0; i--) {
    if (prices[i].date < jan1) {
      baseYtd = prices[i];
      break;
    }
  }
  const prevClose = prices.length > 1 ? prices[prices.length - 2].close : null;
  const pct = (base) => (base && base > 0 ? ((price - base) / base) * 100 : null);
  return { symbol, price, asOf: last.date, ret1y: pct(base1y?.close), retYtd: pct(baseYtd?.close), ret1d: pct(prevClose) };
}
