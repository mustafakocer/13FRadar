import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import './helpers.mjs';

// Ek D — the nightly price cache and everything that reads it: the store's
// compact encoding, the build's plan and quota handling, dailyCloses()
// answering from the files, and the backtest's coverage arithmetic.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prices-'));
process.env.PRICES_DIR = dir;
delete process.env.FMP_API_KEY;
delete process.env.TWELVEDATA_API_KEY;
delete process.env.FINNHUB_API_KEY;

const { encodeSeries, decodeSeries, mergeSeries, writeSeries, readSeries, seriesIndex, seriesKey, returnsFromSeries, clearSeriesCache } = await import('../api/_lib/priceStore.js');
const { universeSymbols, planFetch, buildPrices, listedTicker } = await import('../api/_lib/pricesBuild.js');
const { simulate } = await import('../api/_lib/backtest.js');
const { dailyCloses } = await import('../api/_lib/providers.js');
const { invoke } = await import('../api/_lib/ssr/invoke.js');
const { default: chartHandler } = await import('../api/_handlers/chart.js');
const { default: returnsHandler } = await import('../api/_handlers/returns.js');

const DAY = 86400 * 1000;
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
// A weekday-only series from `from` to `to`, a gentle drift plus a seed so
// two symbols never carry the same numbers.
function series(from, to, { start = 100, drift = 0.0004, seed = 1 } = {}) {
  const out = [];
  let close = start;
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += DAY) {
    const dow = new Date(t).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    close *= 1 + drift + Math.sin(t / DAY / (7 + seed)) * 0.002;
    out.push({ date: iso(t), close: Number(close.toFixed(4)) });
  }
  return out;
}

test('the compact encoding round-trips a series with weekend gaps and keeps the precision a price needs', () => {
  const s = series('2024-12-30', '2025-02-03', { start: 231.4567 });
  const penny = [{ date: '2025-01-02', close: 0.12345 }, { date: '2025-01-03', close: 0.1299 }];
  const enc = encodeSeries(s);
  assert.equal(enc.from, '2024-12-30');
  assert.equal(enc.asOf, '2025-02-03');
  assert.equal(enc.d[0], 0);
  assert.ok(enc.d.includes(3), 'a weekend is a three-day gap');
  const back = decodeSeries(enc);
  assert.deepEqual(back.map((p) => p.date), s.map((p) => p.date));
  assert.equal(back[0].close, Number(s[0].close.toFixed(2)), 'two decimals from ten dollars up');
  assert.equal(decodeSeries(encodeSeries(penny))[0].close, 0.1235, 'four decimals under ten dollars');
  // a duplicate day and a bad close are dropped, order is restored
  const messy = [s[2], s[0], { date: s[1].date, close: NaN }, s[1], s[1]];
  assert.deepEqual(decodeSeries(encodeSeries(messy)).map((p) => p.date), [s[0].date, s[1].date, s[2].date]);
});

test('mergeSeries appends the new days and lets the newer answer win on an overlapping date', () => {
  const older = series('2025-01-01', '2025-01-10');
  const newer = [{ date: '2025-01-10', close: 999 }, { date: '2025-01-13', close: 1000 }];
  const m = mergeSeries(older, newer);
  assert.equal(m[m.length - 1].date, '2025-01-13');
  assert.equal(m.find((p) => p.date === '2025-01-10').close, 999);
  assert.equal(m.length, older.length + 1);
});

test('the store writes one file per symbol under a safe key and reads it back; BRK.B and BRK-B share a file', () => {
  const s = series('2016-09-22', '2026-09-22', { start: 40 });
  const file = writeSeries('BRK.B', s, { src: 'test', now: Date.parse('2026-09-22T20:00:00Z') });
  assert.equal(file.symbol, 'BRK-B');
  assert.ok(fs.existsSync(path.join(dir, 'BRK-B.json')));
  assert.equal(seriesKey('brk-b'), 'BRK-B');
  const r = readSeries('BRK-B');
  assert.equal(r.prices.length, s.length);
  assert.equal(r.asOf, '2026-09-22');
  assert.equal(r.src, 'test');
  const bytes = fs.statSync(path.join(dir, 'BRK-B.json')).size;
  assert.ok(bytes < 40 * 1024, `ten years of closes in under 40 KB (${bytes} bytes)`);
  assert.equal(seriesIndex().get('BRK-B').rows, s.length);
  assert.equal(readSeries('NOPE'), null);
});

test('the universe is the benchmarks, then the table by rank, then exited names — listed tickers only', () => {
  const guruStocks = {
    stocks: [{ ticker: 'AAPL' }, { ticker: 'ECHO 3.875 11-30-30' }, { ticker: 'TMHC*' }, { ticker: 'brk-b' }, { ticker: null }, { ticker: 'BRK.B' }],
    exited: [{ ticker: 'XOM' }, { ticker: 'AAPL' }],
  };
  assert.deepEqual(universeSymbols({ guruStocks }), ['SPY', 'QQQ', 'IWM', 'AAPL', 'BRK-B', 'XOM']);
  assert.ok(listedTicker('HEI-A') && listedTicker('BF.B') && !listedTicker('JD 0.25 06-01-29') && !listedTicker(''));
});

test('the plan fetches missing symbols first in universe order, then the stalest, skips fresh ones, and says how many nights a full fill takes', () => {
  const now = Date.parse('2026-09-22T22:00:00Z');
  const index = new Map([
    ['SPY', { asOf: '2026-09-22' }],
    ['AAPL', { asOf: '2026-09-10' }],
    ['MSFT', { asOf: '2026-09-18' }],
  ]);
  const plan = planFetch(['SPY', 'QQQ', 'AAPL', 'MSFT', 'XOM'], index, { now, maxAgeDays: 1, capacity: 3 });
  assert.deepEqual(plan.jobs.map((j) => `${j.symbol}:${j.reason}`), ['QQQ:missing', 'XOM:missing', 'AAPL:stale']);
  assert.equal(plan.jobs[2].from, '2026-09-10', 'a stale series only fetches from its last close');
  assert.equal(plan.total, 4);
  assert.equal(plan.fresh, 1);
  assert.equal(plan.nights, 2, '4 jobs at 3 a night');
  assert.equal(planFetch(['SPY'], index, { now, capacity: Infinity }).nights, 0);
});

test('buildPrices runs the plan through the providers in order, drops a provider for the night on a quota answer, writes the files and refreshes returns.json from them', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prices-root-'));
  fs.mkdirSync(path.join(root, 'api/_data'), { recursive: true });
  fs.mkdirSync(path.join(root, 'client/public'), { recursive: true });
  const stocks = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA'].map((ticker) => ({ ticker }));
  fs.writeFileSync(path.join(root, 'api/_data/guru-stocks.json'), JSON.stringify({ stocks, exited: [] }));
  fs.writeFileSync(path.join(root, 'client/public/returns.json'), JSON.stringify({ updatedAt: '2026-09-01T00:00:00Z', returns: { AAPL: { ret1y: 1, retYtd: 1, ret1d: 1, asOf: '2026-09-01' } } }));
  const now = Date.parse('2026-09-22T22:00:00Z');
  const calls = { yahoo: [], twelvedata: [], fmp: [] };
  const full = (sym) => series('2016-09-22', '2026-09-22', { start: 50 + sym.length, seed: sym.length });
  const providers = [
    // Yahoo knows everything but the benchmarks' cousin QQQ, and 429s after three calls
    { name: 'yahoo', budget: Infinity, pauseMs: 0, concurrency: 2, fetch: async (sym) => { calls.yahoo.push(sym); if (calls.yahoo.length > 3) throw Object.assign(new Error('Yahoo HTTP 429'), { quota: true }); return sym === 'QQQ' ? null : full(sym); } },
    { name: 'twelvedata', budget: 3, pauseMs: 0, concurrency: 1, fetch: async (sym) => { calls.twelvedata.push(sym); return full(sym); } },
    { name: 'fmp', budget: 1, pauseMs: 0, concurrency: 1, fetch: async (sym) => { calls.fmp.push(sym); return full(sym); } },
  ];
  const log = [];
  const r = await buildPrices({ root, now, providers, log: (m) => log.push(m) });
  assert.match(log[0], /8 symbols in the universe, 1 on file — 8 missing/, 'BRK-B from the earlier test is on file but not in this universe');
  assert.match(log[0], /yahoo → twelvedata \(3\) → fmp \(1\)/);
  assert.ok(calls.yahoo.length <= 5 && calls.yahoo.length >= 3, `yahoo stopped at the 429 (${calls.yahoo.length} calls)`);
  assert.equal(calls.twelvedata.length, 3, 'twelvedata spent its budget on what yahoo left');
  assert.equal(calls.fmp.length, 1);
  assert.equal(r.written, 6, `2 yahoo + 3 twelvedata + 1 fmp (${JSON.stringify(r.bySource)})`);
  assert.equal(r.unknown, 2, 'two symbols left for another night');
  assert.ok(log.some((m) => /yahoo: Yahoo HTTP 429 — done for tonight/.test(m)));
  const idx = JSON.parse(fs.readFileSync(path.join(dir, '_index.json'), 'utf8'));
  assert.equal(idx.count, 7, '6 tonight plus BRK-B');
  assert.equal(idx.tonight.leftover, 2);
  assert.equal(idx.covered, 6);
  const returns = JSON.parse(fs.readFileSync(path.join(root, 'client/public/returns.json'), 'utf8')).returns;
  assert.equal(returns.AAPL.asOf, '2026-09-22', 'the stale AAPL row was refreshed from the cache');
  assert.ok(Number.isFinite(returns.AAPL.ret1y) && returns.AAPL.ret1y !== 1);
  // a second run has nothing to do for the fresh files
  const log2 = [];
  const again = await buildPrices({ root, now, providers, log: (m) => log2.push(m), dryRun: true });
  assert.equal(again.plan.fresh, 6);
  assert.equal(again.plan.jobs.length, 2);
});

test('dailyCloses answers from the cache without a key or a network, and null for a symbol nobody priced', async () => {
  clearSeriesCache();
  const s = await dailyCloses('BRK-B');
  assert.equal(s.length, readSeries('BRK-B').prices.length);
  assert.equal(await dailyCloses('ZZZZ'), null);
});

test('/api/chart reads the cache (thinned for the long ranges) and answers 404 for an unpriced symbol; /api/returns computes the columns from it', async () => {
  const c1 = await invoke(chartHandler, { ticker: 'BRK-B', range: '1y' });
  assert.equal(c1.status, 200);
  assert.ok(c1.body.prices.length > 240 && c1.body.prices.length < 270, `a year of daily bars (${c1.body.prices.length})`);
  assert.equal(c1.body.asOf, '2026-09-22');
  const c5 = await invoke(chartHandler, { ticker: 'BRK-B', range: '5y' });
  assert.ok(c5.body.prices.length < 300, `5y thinned to weekly (${c5.body.prices.length})`);
  assert.equal(c5.body.prices[c5.body.prices.length - 1].date, '2026-09-22', 'the last close is kept');
  assert.equal((await invoke(chartHandler, { ticker: 'ZZZZ' })).status, 404);
  const r = await invoke(returnsHandler, { symbols: 'BRK-B,ZZZZ' });
  assert.equal(r.status, 200);
  assert.ok(Number.isFinite(r.body['BRK-B'].ret1y) && Number.isFinite(r.body['BRK-B'].retYtd));
  assert.equal(r.body.ZZZZ.ret1y, null);
});

test('returnsFromSeries: 1Y from the first close a year back, YTD from the last close of the previous year, 1D from the previous row', () => {
  const now = Date.parse('2026-09-22T22:00:00Z');
  const s = series('2025-06-01', '2026-09-22', { start: 100 });
  const r = returnsFromSeries('X', s, now);
  const last = s[s.length - 1].close;
  const base1y = s.find((p) => p.date >= '2025-09-22').close;
  const baseYtd = [...s].reverse().find((p) => p.date < '2026-01-01').close;
  assert.ok(Math.abs(r.ret1y - ((last - base1y) / base1y) * 100) < 1e-9);
  assert.ok(Math.abs(r.retYtd - ((last - baseYtd) / baseYtd) * 100) < 1e-9);
  assert.ok(Math.abs(r.ret1d - ((last - s[s.length - 2].close) / s[s.length - 2].close) * 100) < 1e-9);
  assert.equal(r.asOf, '2026-09-22');
});

// ---- the backtest arithmetic -------------------------------------------
const TICKERS = ['AAPL', 'AXP', 'BAC', 'KO', 'CVX', 'OXY', 'GOOGL', 'AMZN', 'NVDA', 'MSFT', 'HLT', 'MCO', 'DVA', 'KHC', 'V'];
const cusipOf = (t) => `C${t.padEnd(8, '0')}`;
const filings = [{ reportDate: '2025-09-30' }, { reportDate: '2025-12-31' }, { reportDate: '2026-03-31' }, { reportDate: '2026-06-30' }];
const snapshots = filings.map((f) => ({ f, top: TICKERS.map((t, i) => ({ cusip: cusipOf(t), issuer: `${t} Inc`, weight: 15 - i })) }));
const tickers = Object.fromEntries(TICKERS.map((t) => [cusipOf(t), t]));
const allSeries = (syms) => Object.fromEntries(syms.map((s, i) => [s, series('2025-09-01', '2026-09-22', { start: 20 + i * 7, drift: i % 2 ? 0.0008 : -0.0002, seed: i })]));

test('backtest: 15 stocks and SPY with full series → coverage 100%, benchmark present and not 0.0%, nothing skipped', () => {
  const r = simulate({ snapshots, tickers, priceSeries: allSeries([...TICKERS, 'SPY']), today: '2026-09-22', topN: 15 });
  assert.equal(r.quarters, 4, 'three rebalances plus the open window to today');
  assert.equal(Math.round(r.coverage), 100);
  assert.equal(r.benchmark, 'SPY');
  assert.notEqual(r.totalSpy, 0);
  assert.ok(Number.isFinite(r.totalSpy) && Math.abs(r.totalSpy) > 0.5, `SPY moved (${r.totalSpy})`);
  assert.deepEqual(r.skipped, []);
  assert.ok(r.points.every((p) => Number.isFinite(p.spy)));
});

test('backtest: 5 of 15 without prices → the run still works, coverage says how much was simulated, the skipped names are listed', () => {
  const have = TICKERS.slice(0, 10);
  const priceSeries = allSeries([...have, 'SPY']);
  const r = simulate({ snapshots, tickers, priceSeries, today: '2026-09-22', topN: 15 });
  assert.ok(r.points.length > 1);
  // weights 15..1: the five lightest (5+4+3+2+1 = 15 of 120) are missing
  assert.equal(Math.round(r.coverage), Math.round((105 / 120) * 100));
  assert.equal(r.skipped.length, 5);
  assert.ok(r.skipped.every((s) => s.reason === 'no-prices' && s.ticker && s.issuer));
  assert.ok(r.coverage < 100 && Number.isFinite(r.totalPort));
  // a position whose CUSIP never resolved is skipped for that reason
  const r2 = simulate({ snapshots, tickers: { ...tickers, [cusipOf('V')]: null }, priceSeries, today: '2026-09-22' });
  assert.ok(r2.skipped.some((s) => s.reason === 'no-ticker' && s.cusip === cusipOf('V')));
});

test('backtest: without an SPY series the benchmark is null and the points carry no spy value — never a flat 0.0%', () => {
  const r = simulate({ snapshots, tickers, priceSeries: allSeries(TICKERS), today: '2026-09-22' });
  assert.equal(r.benchmark, null);
  assert.equal(r.totalSpy, null);
  assert.ok(r.points.every((p) => !('spy' in p)));
  assert.equal(Math.round(r.coverage), 100);
});
