import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import './helpers.mjs';
import { CASH_LIKE, cashLikeWeight, cashLikePrev, isCashLike } from '../api/_lib/cashLike.js';
import { snapshotEntry, latestHoldings } from '../api/_lib/latestHoldings.js';
import { invoke } from '../api/_lib/ssr/invoke.js';

const SGOV = '46436E718';
const BIL = '78468R663';
const pos = (cusip, value, putCall = '') => ({ cusip, putCall, issuer: cusip, value, shares: 1, weight: 0 });

test('cash-like: T-bill ETF share lines over the shares value; options neither count nor weigh', () => {
  assert.equal(CASH_LIKE[SGOV], 'SGOV');
  // 50 + 30 cash-like of 400 in shares; the 600 put on SGOV is a notional
  assert.equal(cashLikeWeight([pos(SGOV, 50), pos(BIL, 30), pos('037833100', 320), pos(SGOV, 600, 'Put')]), 20);
  assert.equal(isCashLike(pos(SGOV, 1, 'Call')), false);
  assert.equal(isCashLike(pos(SGOV.toLowerCase(), 1)), true);
});

test('cash-like: none held is 0, an empty or option-only book is null', () => {
  assert.equal(cashLikeWeight([pos('037833100', 100)]), 0);
  assert.equal(cashLikeWeight([]), null);
  assert.equal(cashLikeWeight([pos(SGOV, 100, 'Put')]), null);
  assert.equal(cashLikeWeight(undefined), null);
  // rounded to 0.01 point
  assert.equal(cashLikeWeight([pos(SGOV, 1), pos('037833100', 2)]), 33.33);
});

test('cash-like: a new period moves last run\'s weight to prev; the same period carries prev on', () => {
  const q2 = { reportDate: '2026-06-30', cashLike: 4.5 };
  assert.deepEqual(cashLikePrev(q2, '2026-09-30'), { reportDate: '2026-06-30', w: 4.5 });
  assert.deepEqual(cashLikePrev({ reportDate: '2026-06-30', cashLike: 0 }, '2026-09-30'), { reportDate: '2026-06-30', w: 0 });
  const q3 = { reportDate: '2026-09-30', cashLike: 9, cashLikePrev: { reportDate: '2026-06-30', w: 4.5 } };
  assert.deepEqual(cashLikePrev(q3, '2026-09-30'), { reportDate: '2026-06-30', w: 4.5 });
  // an entry from before the weight was kept says nothing about last quarter
  assert.equal(cashLikePrev({ reportDate: '2026-06-30' }, '2026-09-30'), null);
  assert.equal(cashLikePrev({ reportDate: '2026-09-30' }, '2026-09-30'), null);
  // a new filer, or an older period than stored (never a "previous" from the future)
  assert.equal(cashLikePrev(null, '2026-09-30'), null);
  assert.equal(cashLikePrev(q3, '2026-06-30'), null);
});

test('latest-holdings: the entry stores the weight and the previous one, and the free view returns them', () => {
  const positions = [pos('037833100', 900), pos(SGOV, 100)];
  const e = snapshotEntry({ acc: 'a', filed: '2026-10-14', reportDate: '2026-09-30', aum: 1000, positions, cashLikePrev: { reportDate: '2026-06-30', w: 2 } });
  assert.equal(e.cashLike, 10);
  assert.deepEqual(e.cashLikePrev, { reportDate: '2026-06-30', w: 2 });
  const bare = snapshotEntry({ acc: 'b', filed: '2026-10-14', aum: 1000, positions: [pos('037833100', 1000)] });
  assert.equal(bare.cashLike, 0);
  assert.equal('cashLikePrev' in bare, false);
});

test('holdings API: cash-like weight and the previous period on the free view of the latest filing', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cash-'));
  const file = path.join(dir, 'latest-holdings.json');
  const acc = '0000950123-26-008001';
  const positions = Array.from({ length: 12 }, (_, i) => pos(i === 11 ? SGOV : `03783310${i}`, 1e9 - i * 1e7));
  const entry = snapshotEntry({ acc, filed: '2026-08-14', reportDate: '2026-06-30', aum: positions.reduce((s, p) => s + p.value, 0), positions, cashLikePrev: { reportDate: '2026-03-31', w: 1.25 } });
  fs.writeFileSync(file, JSON.stringify({ updatedAt: 'x', byCik: { '0001067983': entry } }));
  process.env.LATEST_HOLDINGS_FILE = file;
  assert.equal(latestHoldings('1067983', acc).cashLike, entry.cashLike);
  const { default: holdings } = await import('../api/_handlers/holdings.js');
  const r = await invoke(holdings, { cik: '1067983', acc, light: '1' });
  assert.equal(r.status, 200);
  assert.ok(entry.cashLike > 0 && r.body.positions.every((p) => p.cusip !== SGOV), 'the SGOV line is outside the ten rows shipped');
  assert.equal(r.body.cashLike, entry.cashLike, 'the whole book\'s weight, not the ten rows\'');
  assert.deepEqual(r.body.cashLikePrev, { reportDate: '2026-03-31', w: 1.25 });
});
