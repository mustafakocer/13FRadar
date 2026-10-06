// Chained 13F portfolio returns vs SPY (api/_lib/performance.js) and the
// endpoint that serves them: weights times price changes per quarter,
// renormalised over what could be priced, blank under half coverage, the
// stub only while the fund still files, and the index sorted by the year.
import test from 'node:test';
import assert from 'node:assert/strict';
import './helpers.mjs';
import { bookAt, periodReturn, quarterlyReturns, chain, horizonReturns, guruPerformance, MIN_COVERAGE } from '../api/_lib/performance.js';
import { invoke } from '../api/_lib/ssr/invoke.js';

// closes by ticker and date: A doubles every quarter, B halves, SPY +10%
const Q = ['2025-09-30', '2025-12-31', '2026-03-31', '2026-06-30', '2026-09-30'];
const idx = (d) => Q.indexOf(d);
const PX = {
  A: (d) => 10 * 2 ** idx(d),
  B: (d) => 100 / 2 ** idx(d),
  SPY: (d) => 100 * 1.1 ** idx(d),
};
const priceAt = (t, d) => (PX[t] && idx(d) >= 0 ? PX[t](d) : null);
const quarters = Q.map((reportDate) => ({ reportDate }));
const positions = {
  c1: { ticker: 'A', series: Q.map((d) => [d, 1, 1, 60]) },
  c2: { ticker: 'B', series: Q.map((d) => [d, 1, 1, 20]) },
  c3: { ticker: null, series: Q.map((d) => [d, 1, 1, 20]) }, // unresolved: never priced
};

test('a quarter is the filed weights times the price change, over the weight that could be priced', () => {
  const book = bookAt(positions, Q[0]);
  assert.equal(book.length, 3);
  const r = periodReturn(book, Q[0], Q[1], priceAt);
  // 60 × +100% + 20 × −50% over 80 = (60 − 10) / 80 = +62.5%
  assert.equal(r.ret, 62.5);
  assert.equal(r.coverage, 0.8);
  // too little priced: no number
  const thin = periodReturn([{ ticker: 'A', weight: 30 }, { ticker: null, weight: 70 }], Q[0], Q[1], priceAt);
  assert.equal(thin.ret, null);
  assert.ok(thin.coverage < MIN_COVERAGE);
});

test('quarters chain into windows; the stub carries the latest weights to the last close', () => {
  const periods = quarterlyReturns({ quarters, positions, priceAt, asOf: Q[4] });
  assert.equal(periods.length, 4, 'four quarter-to-quarter periods, no stub when asOf is the last quarter end');
  assert.deepEqual(periods.map((p) => p.port), [62.5, 62.5, 62.5, 62.5]);
  assert.deepEqual(periods.map((p) => p.spy), [10, 10, 10, 10]);
  const y1 = chain(periods, 1);
  assert.equal(y1.port, Number(((1.625 ** 4 - 1) * 100).toFixed(1)));
  assert.equal(y1.spy, 46.4);
  assert.equal(y1.from, Q[0]);
  assert.deepEqual(chain(periods, 3), { port: null, spy: null, coverage: null, from: null }, 'not enough quarters for 3 years');
  const h = horizonReturns(periods);
  assert.equal(h.y1.diff, Number((y1.port - 46.4).toFixed(1)));
  assert.equal(h.y3.port, null);
});

test('a fund still filing gets the stub; one that stopped is measured to its last quarter', () => {
  // asOf a month after the last quarter end: a stub with the latest weights
  const stubPx = (t, d) => (d === '2026-10-31' ? PX[t](Q[4]) * (t === 'A' ? 1.5 : 1) : priceAt(t, d));
  const live = guruPerformance({ quarters, positions }, { priceAt: stubPx, asOf: '2026-10-31' });
  assert.equal(live.current, true);
  assert.equal(live.periods.at(-1).stub, true);
  assert.equal(live.periods.at(-1).port, 37.5); // 60 × +50% over 80
  // two years later: no stub, asOf falls back to the last filing
  const gone = guruPerformance({ quarters, positions }, { priceAt: stubPx, asOf: '2028-10-31' });
  assert.equal(gone.current, false);
  assert.equal(gone.asOf, Q[4]);
  assert.ok(!gone.periods.at(-1).stub);
});

test('a null link anywhere in the window blanks the window, not the neighbours', () => {
  const holey = (t, d) => (t === 'SPY' && d === Q[2] ? null : priceAt(t, d));
  const periods = quarterlyReturns({ quarters, positions, priceAt: holey, asOf: Q[4] });
  assert.equal(periods[1].spy, null);
  assert.equal(chain(periods, 1).port, null, 'the year spans the hole');
  assert.equal(periods[3].port, 62.5, 'the quarters around the hole keep their own figures');
});

test('a missing quarter in the window blanks it; the window is a span of dates, not a count of periods', () => {
  // Q1 2026 never filed: periods jump from 2025-12-31 straight to 2026-06-30
  const gap = [...quarters.slice(0, 3), quarters[4]];
  const periods = quarterlyReturns({ quarters: gap, positions, priceAt, asOf: Q[4] });
  assert.equal(periods.length, 3);
  assert.equal(chain(periods, 1).port, null, 'a 182-day period is a missing filing');
  // with the full list, the one-year window ending 2026-09-30 starts at 2025-09-30 — four periods, not however many there are
  const full = quarterlyReturns({ quarters: [{ reportDate: '2025-06-30' }, ...quarters], positions, priceAt: (t, d) => (d === '2025-06-30' ? PX[t](Q[0]) / 2 : priceAt(t, d)), asOf: Q[4] });
  assert.equal(full.length, 5);
  assert.equal(chain(full, 1).from, '2025-09-30');
});

test('/api/guru-performance: one guru, and the index ranked by the year with closed books left out', async () => {
  const { default: handler } = await import('../api/_handlers/guru-performance.js');
  const list = await invoke(handler, {});
  assert.equal(list.status, 200);
  const rows = list.body.rows;
  assert.ok(rows.length > 10, 'the nightly file holds the curated set');
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1].y1 >= rows[i].y1, 'best first');
  assert.ok(rows.every((r) => r.y1 != null && r.spy1 != null));
  const { GURUS } = await import('../api/_lib/gurus.js');
  const closed = new Set(GURUS.filter((g) => g.activeTo).map((g) => String(g.cik).padStart(10, '0')));
  assert.ok(!rows.some((r) => closed.has(r.cik)), 'a fund that stopped filing is not ranked for this year');
  const one = await invoke(handler, { cik: rows[0].cik });
  assert.equal(one.status, 200);
  assert.equal(one.body.horizons.y1.port, rows[0].y1);
  assert.ok(Array.isArray(one.body.periods));
  const none = await invoke(handler, { cik: '0000000001' });
  assert.equal(none.status, 404);
});
