import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFlags } from '../api/_lib/flags.js';
import { trimQuarters, trimQuartersOldestFirst, LIMITS } from '../api/_lib/plan.js';
import * as v from '../api/_lib/validate.js';

test('flags: default on, explicit off, bare name on', () => {
  const f = parseFlags('alerts=off, congress=0,backtest');
  assert.equal(f.alerts, false);
  assert.equal(f.congress, false);
  assert.equal(f.backtest, true);
  assert.equal(f.overlap, true);
  assert.equal(parseFlags(undefined).alerts, true);
});

test('plan: free keeps two quarters, pro keeps all', () => {
  const newestFirst = ['q4', 'q3', 'q2', 'q1'];
  assert.deepEqual(trimQuarters(newestFirst, 'free'), ['q4', 'q3']);
  assert.deepEqual(trimQuarters(newestFirst, 'pro'), newestFirst);
  assert.deepEqual(trimQuartersOldestFirst(['q1', 'q2', 'q3'], 'free'), ['q2', 'q3']);
  assert.deepEqual(trimQuartersOldestFirst(['q1'], 'free'), ['q1']);
  assert.equal(LIMITS.free.watchlist, 5);
});

test('validators', () => {
  assert.equal(v.cik('0001067983'), '0001067983');
  assert.equal(v.cik('abc'), null);
  assert.equal(v.cusip('037833100'), '037833100');
  assert.equal(v.cusip('0378331'), null);
  assert.equal(v.ticker('brk-b'), 'BRK-B');
  assert.equal(v.ticker('<script>'), null);
  assert.equal(v.accession('0000950123-25-001234'), '0000950123-25-001234');
  assert.equal(v.accession('x'), null);
  assert.equal(v.isoDate('2025-06-30'), '2025-06-30');
  assert.equal(v.isoDate('2025-13-45'), null);
  assert.equal(v.intIn('7', 1, 5, 3), 5);
  assert.equal(v.intIn('x', 1, 5, 3), null);
  assert.equal(v.intIn(undefined, 1, 5, 3), 3);
  assert.equal(v.oneOf('weight', ['weight', 'value'], 'weight'), 'weight');
  assert.equal(v.oneOf('zzz', ['weight'], 'weight'), null);
});
