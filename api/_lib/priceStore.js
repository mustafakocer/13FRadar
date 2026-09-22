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

export function decodeSeries(file) {
  if (!file?.from || !Array.isArray(file.d) || !Array.isArray(file.c)) return [];
  const out = [];
  let t = parseDay(file.from);
  for (let i = 0; i < file.d.length; i++) {
    t += file.d[i] * DAY;
    out.push({ date: isoDay(t), close: file.c[i] });
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

// {price, ret1y, retYtd, ret1d} from a [{date, close}] series (ascending):
// the return columns the screener and the manager page show.
export function returnsFromSeries(symbol, prices, now = Date.now()) {
  if (!prices?.length) return { symbol, price: null, ret1y: null, retYtd: null, ret1d: null };
  const last = prices[prices.length - 1];
  const price = last.close;
  const yearAgo = isoDay(now - 365 * DAY);
  const base1y = prices.find((p) => p.date >= yearAgo) || prices[0];
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
