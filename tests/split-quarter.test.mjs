import test from 'node:test';
import assert from 'node:assert/strict';
import { isShareSplit, splitAdjust } from '../api/_lib/history.js';
import { splitAdjustPrev } from '../api/_lib/splitAdjust.js';
import { netActivity } from '../api/_lib/netActivity.js';

test('isShareSplit: whole-number splits and reverse splits, never a spin-off price factor', () => {
  for (const r of [2, 3, 4, 10, 25, 1.5, 1.25, 0.5, 1 / 15, 0.1]) assert.equal(isShareSplit(r), true, String(r));
  for (const r of [1, 0, -2, 1.253, 1.243, 1.437, 1.196, 1.067, 1.941]) assert.equal(isShareSplit(r), false, String(r));
});

test('splitAdjust: spin-off factors leave the share count alone; `until` stops at a date', () => {
  const sp = [{ date: '2024-04-02', ratio: 1.253 }, { date: '2026-04-06', ratio: 25 }, { date: '2026-09-01', ratio: 2 }];
  assert.equal(splitAdjust(100, '2024-03-31', sp), 100 * 25 * 2);
  assert.equal(splitAdjust(100, '2026-03-31', sp, '2026-06-30'), 2500);
  assert.equal(splitAdjust(100, '2026-06-30', sp, '2026-06-30'), 100);
});

test('consensus: a 25-for-1 split between quarters is not a 2,400% add, and a reduce stays a reduce', () => {
  const splits = { BKNG: [{ date: '2026-04-06', ratio: 25 }] };
  const tickerOf = (c) => (c === '09857L108' ? 'BKNG' : null);
  const prev = { positions: [{ cusip: '09857L108', issuer: 'BOOKING', shares: 1000, value: 5_000_000, weight: 10 }] };
  const adj = splitAdjustPrev(prev, '2026-03-31', '2026-06-30', { tickerOf, splits });
  assert.equal(adj.positions[0].shares, 25000);
  assert.equal(prev.positions[0].shares, 1000, 'input untouched');
  // the fund sold a little: 24,000 post-split shares against 25,000
  const cur = { positions: [{ cusip: '09857L108', issuer: 'BOOKING', shares: 24000, value: 4_800_000, weight: 10 }] };
  const rows = netActivity([{ cik: '1', name: 'F', reportDate: '2026-06-30', cur, prev: adj }]);
  const r = [...rows.values()][0];
  const h = r.holders?.[0] || r.deltas?.[0];
  assert.ok(r.netValue < 0, `net value ${r.netValue}`);
  assert.equal(r.adders || 0, 0);
  assert.ok(h);
  // a split after the current report date changes nothing
  assert.equal(splitAdjustPrev(prev, '2026-06-30', '2026-09-30', { tickerOf, splits }), prev);
});
