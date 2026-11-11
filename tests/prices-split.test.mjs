import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import './helpers.mjs';

// A share split inside a stored price series. The store keeps a provider's
// split-adjusted history and appends one quote a night; the first quote after
// a split is in the new shares. Accuray's 1-for-40 (9 November 2026) put
// $0.11 next to $3.82 and the site showed a +3,372.73% day.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prices-split-'));
process.env.PRICES_DIR = dir;
delete process.env.TWELVEDATA_API_KEY;
delete process.env.FINNHUB_API_KEY;

const { writeSeries, readSeries, readSeriesRaw, returnsFromSeries, lastBreak, splitSized, clearSeriesCache } = await import('../api/_lib/priceStore.js');
const { buildPrices, rebaseJobs, settleRebase, restated, topUpCloses, REBASE_TRIES } = await import('../api/_lib/pricesBuild.js');
const { seriesIndex } = await import('../api/_lib/priceStore.js');

const DAY = 86400 * 1000;
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
// weekday closes from `from` to `to`, flat at `close`
function flat(from, to, close) {
  const out = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += DAY) {
    const dow = new Date(t).getUTCDay();
    if (dow !== 0 && dow !== 6) out.push({ date: iso(t), close });
  }
  return out;
}
// Accuray as the store held it: pre-split closes, then the first post-split quote
const PRE = flat('2025-10-01', '2026-11-06', 0.11);
const QUOTE = { date: '2026-11-09', close: 3.82 };
const NOW = Date.parse('2026-11-10T01:40:00Z');

function root(tickers, returns = null) {
  const r = fs.mkdtempSync(path.join(os.tmpdir(), 'prices-split-root-'));
  fs.mkdirSync(path.join(r, 'api/_data'), { recursive: true });
  fs.mkdirSync(path.join(r, 'client/public'), { recursive: true });
  fs.writeFileSync(path.join(r, 'api/_data/guru-stocks.json'), JSON.stringify({ stocks: tickers.map((ticker) => ({ ticker })), exited: [] }));
  if (returns) fs.writeFileSync(path.join(r, 'client/public/returns.json'), JSON.stringify({ updatedAt: '2026-11-09T00:00:00Z', returns }));
  return r;
}
const fresh = () => {
  for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f));
  clearSeriesCache();
};
// the benchmarks are always in the universe: keep them fresh and out of the way
const benchmarks = () => {
  for (const b of ['SPY', 'QQQ', 'IWM']) writeSeries(b, flat('2025-10-01', '2026-11-09', 500), { src: 'twelvedata', hist: '2026-11-09' });
};

test('a close three times the one before it (or a third) is split-sized; smaller moves are not', () => {
  assert.equal(splitSized(0.11, 3.82), true);
  assert.equal(splitSized(100, 25), true, 'a 4-for-1');
  assert.equal(splitSized(100, 180), false, 'a very good day is not a split');
  assert.equal(splitSized(100, 40), false);
  assert.equal(lastBreak([...PRE, QUOTE]), PRE.length);
  assert.equal(lastBreak([...PRE, QUOTE], '2026-11-09'), -1, 'verified through the quote: nothing to check');
});

test('readers get a series with an unverified break from the break on — no return across it; the file keeps every row', () => {
  fresh();
  writeSeries('ARAY', [...PRE, QUOTE], { src: 'finnhub' });
  const s = readSeries('ARAY');
  assert.equal(s.held, PRE.length);
  assert.deepEqual(s.prices, [QUOTE]);
  assert.equal(s.from, '2026-11-09');
  assert.equal(s.asOf, '2026-11-09');
  const r = returnsFromSeries('ARAY', s.prices, NOW);
  assert.equal(r.price, 3.82, 'the price is the real one');
  assert.equal(r.ret1d, null, 'not +3,372.73%');
  assert.equal(r.retYtd, null);
  assert.equal(r.ret1y, null);
  assert.equal(readSeriesRaw('ARAY').prices.length, PRE.length + 1);
});

test('a break inside a verified history is a real move and nothing is withheld', () => {
  fresh();
  writeSeries('MOVE', [...PRE, QUOTE], { src: 'twelvedata', hist: '2026-11-09' });
  const s = readSeries('MOVE');
  assert.equal(s.held, 0);
  assert.equal(s.prices.length, PRE.length + 1);
  assert.ok(returnsFromSeries('MOVE', s.prices, NOW).ret1d > 3000);
  assert.deepEqual(rebaseJobs(seriesIndex(), { now: NOW }), []);
});

test('a file from before the verified-through date existed is checked over its last 90 days only', () => {
  fresh();
  const old = [...flat('2025-01-01', '2025-06-30', 1), ...flat('2025-07-01', '2026-11-09', 10)];
  writeSeries('OLD', old, { src: 'finnhub' });
  assert.equal(readSeries('OLD').held, 0, 'a move sixteen months back came with the history');
});

test('the nightly build fetches a broken series again whole, first, and the adjusted history replaces it; the return row is recomputed', async () => {
  fresh();
  benchmarks();
  writeSeries('ARAY', [...PRE, QUOTE], { src: 'finnhub' });
  const r = root(['ARAY', 'NEWCO'], { ARAY: { ret1y: 226.5, retYtd: 365.85, ret1d: 3372.73, asOf: '2026-11-09' } });
  const calls = [];
  // the history provider answers in today's shares: every old close × 40
  const adjusted = [...PRE.map((p) => ({ date: p.date, close: 4.4 })), QUOTE];
  const providers = [
    { name: 'twelvedata', budget: 5, pauseMs: 0, concurrency: 1, fetch: async (sym, from) => { calls.push([sym, from]); return sym === 'ARAY' ? adjusted : flat('2025-10-01', '2026-11-09', 20); } },
  ];
  const log = [];
  const out = await buildPrices({ root: r, now: NOW, providers, log: (m) => log.push(m) });
  assert.deepEqual(calls[0], ['ARAY', null], 'the broken series goes before the missing one, and is asked for whole');
  assert.equal(out.rebased, 1);
  assert.ok(log.some((m) => /1 series with a split-sized break .* ARAY \(2026-11-09\)/.test(m)), log.join('\n'));
  const s = readSeries('ARAY');
  assert.equal(s.held, 0);
  assert.equal(s.prices.length, PRE.length + 1);
  assert.equal(readSeriesRaw('ARAY').hist, '2026-11-09');
  const row = JSON.parse(fs.readFileSync(path.join(r, 'client/public/returns.json'), 'utf8')).returns.ARAY;
  assert.equal(row.ret1d, -13.18, 'the day Accuray actually had');
  // nothing left to do for it
  assert.deepEqual(rebaseJobs(seriesIndex(), { now: NOW }), []);
});

test('with no history provider tonight the false return row is withdrawn and the series stays flagged', async () => {
  fresh();
  benchmarks();
  writeSeries('ARAY', [...PRE, QUOTE], { src: 'finnhub' });
  const r = root(['ARAY'], { ARAY: { ret1y: 226.5, retYtd: 365.85, ret1d: 3372.73, asOf: '2026-11-09' }, SPY: { ret1y: 0, retYtd: 0, ret1d: 0, asOf: '2026-11-09' } });
  await buildPrices({ root: r, now: NOW, providers: [], log: () => {} });
  const returns = JSON.parse(fs.readFileSync(path.join(r, 'client/public/returns.json'), 'utf8')).returns;
  assert.equal('ARAY' in returns, false);
  assert.ok(returns.SPY);
  assert.equal(rebaseJobs(seriesIndex(), { now: NOW }).length, 1);
});

test(`a provider still showing the move is believed on night ${REBASE_TRIES}: until then the series stays unverified`, async () => {
  fresh();
  benchmarks();
  const real = [...flat('2025-10-01', '2026-11-06', 10), { date: '2026-11-09', close: 2 }];
  writeSeries('CRSH', real, { src: 'finnhub' });
  const r = root(['CRSH']);
  const providers = [{ name: 'twelvedata', budget: 5, pauseMs: 0, concurrency: 1, fetch: async () => real }];
  const first = await buildPrices({ root: r, now: NOW, providers, log: () => {} });
  assert.equal(first.unsettled, 1);
  assert.equal(readSeries('CRSH').held > 0, true, 'night one: the split may not be booked yet');
  assert.equal(readSeriesRaw('CRSH').rb, 1);
  const second = await buildPrices({ root: r, now: NOW + DAY, providers, log: () => {} });
  assert.equal(second.rebased, 1);
  const s = readSeries('CRSH');
  assert.equal(s.held, 0, 'night two: an −80% day it was');
  assert.equal(returnsFromSeries('CRSH', s.prices, NOW).ret1d, -80);
  assert.equal(readSeriesRaw('CRSH').rb, 0);
});

test('a symbol no history provider knows is cut at the break — closes in other shares are not kept beside it', async () => {
  fresh();
  benchmarks();
  writeSeries('ONLYFH', [...PRE, QUOTE], { src: 'finnhub' });
  const r = root(['ONLYFH']);
  const providers = [
    { name: 'twelvedata', budget: 5, pauseMs: 0, concurrency: 1, fetch: async () => null },
    { name: 'finnhub', budget: 5, pauseMs: 0, concurrency: 1, appendOnly: true, fetch: async () => [{ date: '2026-11-10', close: 3.9 }] },
  ];
  // the first night's run is the day after the quote: the series is stale and Finnhub extends it
  const first = await buildPrices({ root: r, now: NOW + DAY, providers, log: () => {} });
  assert.equal(first.cut, 0);
  assert.equal(readSeriesRaw('ONLYFH').prices.length, PRE.length + 2, 'the append kept the withheld rows');
  assert.equal(readSeriesRaw('ONLYFH').rb, 1);
  const second = await buildPrices({ root: r, now: NOW + DAY, providers, log: () => {} });
  assert.equal(second.cut, 1);
  const raw = readSeriesRaw('ONLYFH');
  assert.deepEqual(raw.prices.map((p) => p.date), ['2026-11-09', '2026-11-10']);
  assert.equal(raw.hist, '2026-11-10');
});

test('an appended quote never moves the verified-through date, in the build or in the insider top-up', async () => {
  fresh();
  benchmarks();
  writeSeries('ARAY', PRE, { src: 'twelvedata', hist: '2026-11-06' });
  process.env.FINNHUB_API_KEY = 'test';
  try {
    await topUpCloses(['ARAY'], { budget: 5, now: NOW, log: () => {}, pauseMs: 0, quote: async () => [QUOTE] });
  } finally {
    delete process.env.FINNHUB_API_KEY;
  }
  const raw = readSeriesRaw('ARAY');
  assert.equal(raw.hist, '2026-11-06');
  assert.equal(raw.src, 'twelvedata');
  assert.equal(raw.prices.length, PRE.length + 1);
  assert.equal(readSeries('ARAY').held, PRE.length, 'the quote after a split is caught the moment it lands');
});

test('settleRebase keeps post-break quotes newer than the provider\'s last bar', () => {
  const have = { prices: [...PRE, QUOTE, { date: '2026-11-10', close: 3.9 }], rb: 0 };
  const job = { breakPrev: '2026-11-06', breakDate: '2026-11-09' };
  const adjusted = [...PRE.map((p) => ({ date: p.date, close: 4.4 })), QUOTE];
  const r = settleRebase(job, have, adjusted);
  assert.equal(r.fixed, true);
  assert.equal(r.prices.at(-1).date, '2026-11-10');
  assert.equal(r.hist, '2026-11-10');
});

test('restated: the same day in other shares means the history cannot be appended (a 2-for-1 is too small to be a break)', async () => {
  const have = flat('2026-10-01', '2026-11-06', 100);
  assert.equal(restated(have, [{ date: '2026-11-06', close: 50 }, { date: '2026-11-09', close: 51 }]), true);
  assert.equal(restated(have, [{ date: '2026-11-06', close: 100 }, { date: '2026-11-09', close: 51 }]), false, 'a real halving the next day');
  assert.equal(restated(have, [{ date: '2026-11-09', close: 50 }]), false, 'no day in common: nothing to compare');

  fresh();
  benchmarks();
  writeSeries('TWO', have, { src: 'twelvedata', hist: '2026-11-06' });
  const r = root(['TWO']);
  const whole = [...flat('2026-10-01', '2026-11-06', 50), { date: '2026-11-09', close: 51 }];
  const calls = [];
  const providers = [{ name: 'twelvedata', budget: 5, pauseMs: 0, concurrency: 1, fetch: async (sym, from) => { if (sym !== 'TWO') return null; calls.push(from); return from ? whole.slice(-2) : whole; } }];
  await buildPrices({ root: r, now: NOW, providers, log: () => {} });
  assert.deepEqual(calls, ['2026-11-06', null], 'asked for the days since, then for everything');
  const s = readSeries('TWO');
  assert.equal(s.prices[0].close, 50);
  assert.equal(returnsFromSeries('TWO', s.prices, NOW).ret1d, 2);
});
