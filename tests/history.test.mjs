import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { root } from './helpers.mjs';
import { timeHeldLabel, splitAdjust, topRankedCusips } from '../api/_lib/history.js';
import { invoke } from '../api/_lib/ssr/invoke.js';

process.env.GURU_HISTORY_FILE = process.env.GURU_HISTORY_FILE || path.join(root, 'tests', 'fixtures', 'guru-history.fixture.json');

test('time held labels and the >10 Years cap', () => {
  assert.equal(timeHeldLabel(0, 'en'), null);
  assert.equal(timeHeldLabel(3, 'en'), '3 Q');
  assert.equal(timeHeldLabel(4, 'en'), '1 Year');
  assert.equal(timeHeldLabel(10, 'en'), '2.5 Years');
  assert.equal(timeHeldLabel(40, 'en'), '>10 Years');
  assert.equal(timeHeldLabel(40, 'tr'), '>10 Yıl');
});

test('split adjustment applies only to splits after the report date', () => {
  const splits = [{ date: '2020-08-31', ratio: 4 }];
  assert.equal(splitAdjust(100, '2020-06-30', splits), 400);
  assert.equal(splitAdjust(100, '2020-09-30', splits), 100);
});

test('guru-history handler: quarters, time held map and pair series', async () => {
  const { default: handler } = await import('../api/_handlers/guru-history.js');
  const all = await invoke(handler, { cik: '0001067983' });
  assert.equal(all.status, 200);
  assert.equal(all.body.quarters.length, 2);
  assert.equal(all.body.timeHeld['037833100'].quarters, 2);
  const pair = await invoke(handler, { cik: '0001067983', ticker: 'AAPL' });
  assert.deepEqual(pair.body.rows.map((r) => r.activity), ['new', 'reduce']);
  assert.equal(pair.body.rows[1].deltaPct, -25);
  const exited = await invoke(handler, { cik: '0001067983', ticker: 'CMG' });
  assert.deepEqual(exited.body.rows.map((r) => r.activity), ['new', 'exit']);
  const unknown = await invoke(handler, { cik: '0000000001' });
  assert.equal(unknown.status, 404);
});

test('topRankedCusips keeps a position that was ever in a quarter top N', () => {
  const positions = {
    A: { series: [['2025-12-31', 1, 900, 1], ['2026-03-31', 1, 900, 1]] },
    B: { series: [['2025-12-31', 1, 500, 1], ['2026-03-31', 1, 100, 1]] },
    C: { series: [['2025-12-31', 1, 10, 1], ['2026-03-31', 1, 800, 1]] },
    D: { series: [['2025-12-31', 1, 5, 1], ['2026-03-31', 1, 5, 1]] },
  };
  const keep = topRankedCusips(positions, 2);
  assert.deepEqual([...keep].sort(), ['A', 'B', 'C']); // B: top-2 in Q4, C: top-2 in Q1, D never
});
