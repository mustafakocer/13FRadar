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
//   { symbol, src, from, asOf, updatedAt, d: [gap, gap, …], c: [close, …] }
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

const memo = new Map();
export const clearSeriesCache = () => memo.clear();

// { symbol, src, from, asOf, updatedAt, prices: [{date, close}] } or null
// when no build has priced the symbol. Memoised per process: the files only
// change with a deploy (or, in the build, through writeSeries below).
export function readSeries(symbol) {
  const key = seriesKey(symbol);
  if (!key) return null;
  if (memo.has(key)) return memo.get(key);
  let out = null;
  try {
    const file = JSON.parse(fs.readFileSync(path.join(pricesDir(), `${key}.json`), 'utf8'));
    out = { symbol: file.symbol || key, src: file.src || null, from: file.from, asOf: file.asOf, updatedAt: file.updatedAt || null, prices: decodeSeries(file) };
  } catch {
    out = null;
  }
  memo.set(key, out);
  return out;
}

export function writeSeries(symbol, prices, { src = null, now = Date.now() } = {}) {
  const key = seriesKey(symbol);
  const enc = encodeSeries(prices);
  if (!enc.c.length) return null;
  const dir = pricesDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = { symbol: key, src, from: enc.from, asOf: enc.asOf, updatedAt: new Date(now).toISOString(), d: enc.d, c: enc.c };
  fs.writeFileSync(path.join(dir, `${key}.json`), JSON.stringify(file));
  memo.delete(key);
  return file;
}

// What the directory holds, without decoding: Map key → { asOf, from, rows, src }.
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
      out.set(name.slice(0, -5), { asOf: file.asOf, from: file.from, rows: file.c?.length || 0, src: file.src || null });
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

// A return is only as good as the series between its two closes. Two things
// break that series, and both made the screener print returns no market
// produced (2026-10, data audit):
//   · a jump of ×3 or more in one day — a reverse split the provider did not
//     adjust (VYNE $0.76 → $46.17 the morning of its 1-for-60) or a bad print
//     that came back the next day. A real one-day tripling or a two-thirds
//     crash does happen; hiding that return costs a blank cell, publishing a
//     split as a gain costs the number.
//   · a hole of weeks between two closes — the symbol went dark and came back,
//     often as a different company (BSP's last close before 2026 was $0.0015
//     in 2022; "YTD +3,137,900%").
// A base more than BASE_SLACK_DAYS from the date it stands for is the same
// hole seen from the other side: it is not that day's price.
export const BREAK_FACTOR = 3;
export const MAX_GAP_DAYS = 20;
export const BASE_SLACK_DAYS = 20;
// A base under a cent that "returns" over 1,000% is a sub-penny print, not a
// tenfold year: AMFN's series sits at $0.0009 in October 2025 where the
// market's 52-week low is $0.023, and climbs to $0.036 in steps of 30–70% —
// no single day trips the ×3 rule, the year reads +2,820%.
export const SUBPENNY_BASE = 0.01;
export const SUBPENNY_MAX_RETURN = 1000;

// The index of the last row that follows a break (0 when there is none): a
// base at or after it reaches today over clean closes.
export function lastBreak(prices) {
  for (let i = prices.length - 1; i > 0; i--) {
    const q = prices[i].close / prices[i - 1].close;
    if (!(q < BREAK_FACTOR && q > 1 / BREAK_FACTOR)) return i;
    if ((parseDay(prices[i].date) - parseDay(prices[i - 1].date)) / DAY > MAX_GAP_DAYS) return i;
  }
  return 0;
}

// The US trading days: SPY's closes on file. Every symbol here trades on
// the same exchange calendar, so a symbol's previous close should sit on
// SPY's previous date.
export function tradingDays() {
  return (readSeries('SPY')?.prices || []).map((p) => p.date);
}

// The trading day before `date`, or null when the calendar cannot say. A
// date past the calendar's end (SPY not yet updated tonight) is answered
// only across a weekend: a weekday in between could be a holiday or a day
// SPY is itself missing, and a guessed date would plant a close on it.
export function previousTradingDay(date, days = tradingDays()) {
  if (!date || !days.length) return null;
  let lo = 0;
  let hi = days.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (days[mid] === date) return mid > 0 ? days[mid - 1] : null;
    if (days[mid] < date) lo = mid + 1;
    else hi = mid - 1;
  }
  const last = days[days.length - 1];
  if (date <= last) return null; // inside the calendar but not a trading day
  for (let t = parseDay(last) + DAY; t < parseDay(date); t += DAY) {
    const dow = new Date(t).getUTCDay();
    if (dow !== 0 && dow !== 6) return null;
  }
  return last;
}

// {price, ret1y, retYtd, ret1d} from a [{date, close}] series (ascending):
// the return columns the screener and the manager page show. `calendar`
// (tradingDays()) lets 1D refuse a previous row that is not the previous
// trading day: with a close missing in between, "1D" would be two days.
export function returnsFromSeries(symbol, prices, now = Date.now(), { calendar = null } = {}) {
  if (!prices?.length) return { symbol, price: null, ret1y: null, retYtd: null, ret1d: null };
  const last = prices[prices.length - 1];
  const price = last.close;
  const yearAgo = isoDay(now - 365 * DAY);
  const clean = lastBreak(prices);
  const near = (a, b) => Math.abs(parseDay(a) - parseDay(b)) / DAY <= BASE_SLACK_DAYS;
  // A series that starts after the year-ago date (a listing younger than a
  // year) has no 1Y base: its first close would make "1Y" a since-listing
  // return. A week of slack covers a year-ago date that fell on a weekend
  // or holiday.
  const covers1y = prices[0].date <= isoDay(now - 358 * DAY);
  const i1y = covers1y ? prices.findIndex((p) => p.date >= yearAgo) : -1;
  const base1y = i1y >= clean && near(prices[i1y].date, yearAgo) ? prices[i1y] : null;
  const jan1 = `${new Date(now).getUTCFullYear()}-01-01`;
  let baseYtd = null;
  for (let i = prices.length - 1; i >= 0; i--) {
    if (prices[i].date < jan1) {
      if (i >= clean && near(prices[i].date, jan1)) baseYtd = prices[i];
      break;
    }
  }
  let prevClose = prices.length > 1 && prices.length - 2 >= clean ? prices[prices.length - 2].close : null;
  if (prevClose != null && calendar?.length) {
    const expected = previousTradingDay(last.date, calendar);
    if (expected && prices[prices.length - 2].date !== expected) prevClose = null;
  }
  const pct = (base) => (base && base > 0 ? ((price - base) / base) * 100 : null);
  const long = (base) => {
    const r = pct(base);
    return r != null && base < SUBPENNY_BASE && r > SUBPENNY_MAX_RETURN ? null : r;
  };
  return { symbol, price, asOf: last.date, ret1y: long(base1y?.close), retYtd: long(baseYtd?.close), ret1d: pct(prevClose) };
}
