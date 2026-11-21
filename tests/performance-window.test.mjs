// What "the last N years" means in a guru's chained return
// (api/_lib/performance.js chain). tests/performance.test.mjs checks the
// chaining; this pins the WINDOW, because it is not what the label suggests:
//
//   the window ends at the last period's end (the stub's last close while
//   the fund is still filing) and starts at the quarter end on or just
//   before `end − N years` — quarterly weights cannot split a quarter.
//
// So "1 year" is exactly twelve months only when the last period ends on a
// quarter end; with a stub it is the four quarters before the stub's quarter
// PLUS the stub — up to fifteen months. On 2026-11-19 the one-year figure
// runs from 2025-09-30: 13.6 months. A page that prints it as "last 1 year"
// next to a true twelve-month index return is comparing two different
// windows; the dates (`from`, `to`) are returned so the page can say which.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chain, horizonReturns, yearsBefore, daysBetween } from '../api/_lib/performance.js';

// six quarter-to-quarter periods of +10% (index +5%), by hand
const ENDS = ['2025-03-31', '2025-06-30', '2025-09-30', '2025-12-31', '2026-03-31', '2026-06-30', '2026-09-30'];
const quarterly = ENDS.slice(1).map((to, i) => ({ from: ENDS[i], to, port: 10, spy: 5, coverage: 0.9 }));
const pct = (x) => Number(((x - 1) * 100).toFixed(1));

test('ending on a quarter end, one year is exactly the last four quarters', () => {
  const y1 = chain(quarterly, 1);
  assert.equal(y1.from, '2025-09-30');
  assert.equal(y1.to, '2026-09-30');
  assert.equal(daysBetween(y1.from, y1.to), 365);
  assert.equal(y1.port, pct(1.1 ** 4)); // 46.4
  assert.equal(y1.spy, pct(1.05 ** 4)); // 21.6
});

test('with a stub, one year is four quarters plus the stub: 13.6 months on 2026-11-19', () => {
  const periods = [...quarterly, { from: '2026-09-30', to: '2026-11-19', port: 10, spy: 5, coverage: 0.9, stub: true }];
  const y1 = chain(periods, 1);
  assert.equal(yearsBefore('2026-11-19', 1), '2025-11-19');
  // the quarter that contains 2025-11-19 is taken whole
  assert.equal(y1.from, '2025-09-30');
  assert.equal(y1.to, '2026-11-19');
  assert.equal(daysBetween(y1.from, y1.to), 415); // 13.6 months, not 12
  // five links, not four
  assert.equal(y1.port, pct(1.1 ** 5)); // 61.1
  assert.equal(y1.spy, pct(1.05 ** 5)); // 27.6
  assert.notEqual(y1.port, pct(1.1 ** 4));
});

test('the window is never shorter than N years and never a full quarter longer than it needs', () => {
  // slide the stub's end through the quarter after 2026-09-30
  for (const end of ['2026-10-01', '2026-10-31', '2026-11-19', '2026-12-30']) {
    const periods = [...quarterly, { from: '2026-09-30', to: end, port: 1, spy: 1, coverage: 0.9, stub: true }];
    const y1 = chain(periods, 1);
    const days = daysBetween(y1.from, y1.to);
    assert.equal(y1.from, '2025-09-30', end);
    assert.ok(days >= 365 && days < 365 + 92, `${end}: ${days} days`);
  }
  // on the next quarter end the window snaps back to twelve months
  const next = [...quarterly, { from: '2026-09-30', to: '2026-12-31', port: 10, spy: 5, coverage: 0.9 }];
  const y1 = chain(next, 1);
  assert.equal(y1.from, '2025-12-31');
  assert.equal(daysBetween(y1.from, y1.to), 365);
  assert.equal(y1.port, pct(1.1 ** 4));
});

test('every horizon reports the window it used, and none when it cannot be measured', () => {
  const periods = [...quarterly, { from: '2026-09-30', to: '2026-11-19', port: 10, spy: 5, coverage: 0.9, stub: true }];
  const h = horizonReturns(periods);
  assert.equal(h.y1.from, '2025-09-30');
  assert.equal(h.y1.to, '2026-11-19');
  assert.equal(h.y1.diff, Number((h.y1.port - h.y1.spy).toFixed(1)));
  // a year and a half of data: three years cannot be measured, and says so with nulls
  assert.equal(h.y3.port, null);
  assert.equal(h.y3.spy, null);
  assert.equal(h.y3.from, null);
  // coverage of a window is its weakest quarter
  const thin = periods.map((p, i) => (i === 3 ? { ...p, coverage: 0.55 } : p));
  assert.equal(chain(thin, 1).coverage, 0.55);
});
