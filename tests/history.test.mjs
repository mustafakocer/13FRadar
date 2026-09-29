import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { root } from './helpers.mjs';
import { timeHeldLabel, splitAdjust, topRankedCusips } from '../api/_lib/history.js';
import { invoke } from '../api/_lib/ssr/invoke.js';

process.env.GURU_HISTORY_FILE = process.env.GURU_HISTORY_FILE || path.join(root, 'tests', 'fixtures', 'guru-history.fixture.json');

test('time held labels and the >10 Years cap', () => {
  assert.equal(timeHeldLabel(0), null);
  assert.equal(timeHeldLabel(3), '3 Q');
  assert.equal(timeHeldLabel(4), '1 Year');
  assert.equal(timeHeldLabel(10), '2.5 Years');
  assert.equal(timeHeldLabel(40), '>10 Years');
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

// KO has been in Berkshire's book since 1988; the history starts in 2016.
test('time held that reaches the start of the data says so: "9,8+ Yıl (veri 2016\'dan)"', async () => {
  assert.equal(timeHeldLabel(39, 'tr', { dataFrom: '2016-12-31' }), "9,8+ Yıl (veri 2016'dan)");
  assert.equal(timeHeldLabel(39, 'en', { dataFrom: '2016-12-31' }), '9.8+ Years (data from 2016)');
  assert.equal(timeHeldLabel(22, 'tr', { dataFrom: '2021-03-31' }), "5,5+ Yıl (veri 2021'den)");
  assert.equal(timeHeldLabel(3, 'tr', { dataFrom: '2026-03-31' }), "3+ Çeyrek (veri 2026'dan)");
  assert.equal(timeHeldLabel(39, 'tr'), '9,8 Yıl', 'a streak that started inside the data is exact');
  assert.equal(timeHeldLabel(40, 'tr', { dataFrom: '2016-09-30' }), '>10 Yıl');
  const { trAblative } = await import('../client/src/lib/timeHeld.js');
  assert.deepEqual([2014, 2015, 2016, 2017, 2018, 2019, 2020, 2010, 2023].map((y) => `${y}${trAblative(y)}`), ["2014'ten", "2015'ten", "2016'dan", "2017'den", "2018'den", "2019'dan", "2020'den", "2010'dan", "2023'ten"]);
});

test('Berkshire KO in the stored history: held since the first quarter of the data, labelled as such', async () => {
  const fs = await import('node:fs');
  const H = JSON.parse(fs.readFileSync(new URL('../api/_data/guru-history.json', import.meta.url), 'utf8'));
  const { resolveTimeHeld } = await import('../api/_lib/historyResolve.js');
  const g = H.gurus['0001067983'];
  const ko = Object.values(resolveTimeHeld(g)).find((x) => x.ticker === 'KO');
  assert.equal(ko.dataFrom, g.quarters[0].reportDate);
  assert.match(timeHeldLabel(ko.quarters, 'tr', { dataFrom: ko.dataFrom }), /^\d+,\d\+ Yıl \(veri 2016'dan\)$|^>10 Yıl$/);
});
