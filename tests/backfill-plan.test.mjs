import test from 'node:test';
import assert from 'node:assert/strict';
import {
  quartersToBackfill,
  advanceCursor,
  chunk,
  missingFilings,
  holdingRows,
  parseQuarter,
  quarterKey,
  prevQuarter,
  nextQuarter,
  FIRST_QUARTER,
} from '../api/_lib/backfillPlan.js';

// The historical backfill is too large for one pass, so the only thing that
// makes it work is being resumable without repeating or skipping a quarter.

const TODAY = new Date('2026-09-16T00:00:00Z');

test('quarter arithmetic wraps years in both directions', () => {
  assert.deepEqual(prevQuarter({ y: 2026, q: 1 }), { y: 2025, q: 4 });
  assert.deepEqual(nextQuarter({ y: 2025, q: 4 }), { y: 2026, q: 1 });
  assert.deepEqual(parseQuarter('2013Q1'), { y: 2013, q: 1 });
  assert.equal(parseQuarter('2013Q5'), null);
  assert.equal(parseQuarter('nonsense'), null);
  assert.equal(quarterKey({ y: 2026, q: 3 }), '2026Q3');
});

test('a fresh backfill starts at the newest quarter and walks back', () => {
  assert.deepEqual(quartersToBackfill({ today: TODAY, max: 3 }), ['2026Q3', '2026Q2', '2026Q1']);
});

test('a resumed backfill continues from the cursor, not from the top', () => {
  assert.deepEqual(quartersToBackfill({ from: '2020Q2', today: TODAY, max: 3 }), ['2020Q2', '2020Q1', '2019Q4']);
});

test('the backfill stops at the first quarter it covers', () => {
  const q = quartersToBackfill({ from: '2013Q2', today: TODAY, max: 10 });
  assert.deepEqual(q, ['2013Q2', '2013Q1']);
  assert.deepEqual(quartersToBackfill({ from: '2012Q4', today: TODAY, max: 10 }), [], 'before coverage, nothing to do');
});

test('a cursor from the future is clamped to the newest real quarter', () => {
  assert.deepEqual(quartersToBackfill({ from: '2030Q1', today: TODAY, max: 2 }), ['2026Q3', '2026Q2']);
});

test('the cursor moves past completed quarters only', () => {
  assert.deepEqual(advanceCursor(['2026Q3', '2026Q2']), { cursor: '2026Q1', finished: false });
  // the run failed on 2026Q2 and only finished the newest
  assert.deepEqual(advanceCursor(['2026Q3']), { cursor: '2026Q2', finished: false });
  assert.deepEqual(advanceCursor([]), { cursor: null, finished: false }, 'a run that did nothing does not move');
});

test('reaching the first covered quarter finishes the job', () => {
  const r = advanceCursor(['2013Q2', '2013Q1']);
  assert.equal(r.finished, true);
  assert.equal(r.cursor, quarterKey(FIRST_QUARTER));
});

test('a half-finished quarter only re-reads what it is missing', () => {
  const index = [
    { acc: 'a1', cik: '1' },
    { acc: 'a2', cik: '2' },
    { acc: 'a3', cik: '3' },
    { acc: 'a2', cik: '2' }, // the index lists a filing twice
  ];
  assert.deepEqual(
    missingFilings(index, ['a1']).map((r) => r.acc),
    ['a2', 'a3']
  );
  assert.deepEqual(missingFilings(index, ['a1', 'a2', 'a3']), [], 'a finished quarter re-reads nothing');
});

test('batching splits evenly and refuses a nonsense size', () => {
  const rows = Array.from({ length: 2500 }, (_, i) => i);
  const parts = chunk(rows, 1000);
  assert.deepEqual(parts.map((p) => p.length), [1000, 1000, 500]);
  assert.equal(parts.flat().length, rows.length);
  assert.deepEqual(chunk([], 10), []);
  assert.throws(() => chunk(rows, 0), RangeError);
});

test('positions become rows the store can hold, and junk is dropped', () => {
  const rows = holdingRows('acc-1', [
    { cusip: '037833100', issuer: 'APPLE INC', class: 'COM', value: 1234.6, shares: 10.2, weight: 12.345678 },
    { cusip: '037833100', putCall: 'Put', issuer: 'APPLE INC', value: 10, shares: 1, weight: 0.1 },
    { cusip: null, issuer: 'NO CUSIP', value: 5, shares: 1 },
    null,
  ]);
  assert.equal(rows.length, 2, 'a position with no CUSIP cannot be joined to anything');
  assert.equal(rows[0].value, 1235);
  assert.equal(rows[0].shares, 10);
  assert.equal(rows[0].weight, 12.3457);
  assert.equal(rows[0].put_call, '', 'common stock carries an empty side, not null');
  assert.equal(rows[1].put_call, 'Put');
  // the pair shares a CUSIP and differs only by side — the primary key has to
  // keep both, which is why put_call is part of it
  assert.equal(rows[0].cusip, rows[1].cusip);
});
