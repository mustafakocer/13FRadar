import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeBooks, mergeSuccessor, applySuccessors, predecessorOf } from '../api/_lib/successorHistory.js';
import { GURUS } from '../api/_lib/gurus.js';

const q = (reportDate, acc, aum, extra = {}) => ({ reportDate, acc, filed: reportDate, aum, count: 0, turnover: null, newCount: null, exitCount: null, top10: [], ...extra });

test('successor: the registry links Ackman and Einhorn to their new filers', () => {
  assert.equal(predecessorOf('0002026053', GURUS)?.cik, '0001336528');
  assert.equal(predecessorOf('0001489933', GURUS)?.cik, '0001079114');
  assert.equal(predecessorOf('0001067983', GURUS), null);
});

test('successor: two books of one period are added up by security and put/call', () => {
  const m = mergeBooks(
    { aum: 100, positions: [{ cusip: 'A', putCall: '', shares: 10, value: 80 }, { cusip: 'B', putCall: '', shares: 1, value: 20 }] },
    { aum: 50, positions: [{ cusip: 'a', putCall: '', shares: 5, value: 40 }, { cusip: 'A', putCall: 'Put', shares: 1, value: 10 }] },
  );
  assert.equal(m.aum, 150);
  assert.deepEqual(m.positions.map((p) => [p.cusip, p.putCall, p.shares, p.value]), [['A', '', 15, 120], ['B', '', 1, 20], ['A', 'Put', 1, 10]]);
  assert.equal(Math.round(m.positions[0].weight), 80);
  assert.equal(mergeBooks(null, m), m);
});

test("successor: Ackman's new filer's first full quarter is not the whole book bought", () => {
  // the old filer held HHH and QSR; the new one HHH only, then everything
  const pred = { name: 'Old', quarters: [q('2026-03-31', 'old-q1', 300)], positions: {
    H: { issuer: 'HHH', ticker: 'HHH', series: [['2026-03-31', 18, 180, 60]] },
    Q: { issuer: 'QSR', ticker: 'QSR', series: [['2026-03-31', 12, 120, 40]] },
  } };
  const own = { name: 'New', fp: 'x', quarters: [q('2026-03-31', 'new-q1', 90), q('2026-06-30', 'new-q2', 420, { newCount: 2, exitCount: 0 })], positions: {
    H: { issuer: 'HHH', ticker: 'HHH', series: [['2026-03-31', 9, 90, 100], ['2026-06-30', 27, 300, 71]] },
    Q: { issuer: 'QSR', ticker: 'QSR', series: [['2026-06-30', 12, 120, 29]] },
  } };
  const m = mergeSuccessor(pred, own);
  assert.equal(m.name, 'New');
  assert.equal(m.predecessor, 'Old');
  const [q1, q2] = m.quarters;
  assert.equal(q1.source, 'both');
  assert.equal(q1.aum, 390);
  assert.equal(q1.acc, 'old-q1', 'the larger book names the quarter');
  assert.equal(q1.alsoAcc, 'new-q1');
  assert.equal(q1.count, 2);
  assert.deepEqual(m.positions.H.series[0].slice(0, 3), ['2026-03-31', 27, 270]);
  assert.equal(q2.newCount, 0, 'QSR was held');
  assert.equal(q2.exitCount, 0);
  assert.equal(m.positions.Q.heldQuarters, 2);
  assert.equal(m.positions.Q.firstSeen, '2026-03-31');
});

test('successor: applying twice is applying once, and the filer keeps its own entry for the next build', () => {
  const pred = { name: 'Old', quarters: [q('2026-03-31', 'o', 10)], positions: { A: { issuer: 'A', series: [['2026-03-31', 1, 10, 100]] } } };
  const own = { name: 'New', quarters: [q('2026-06-30', 'n', 10)], positions: { A: { issuer: 'A', series: [['2026-06-30', 1, 10, 100]] } } };
  const gurus = [{ cik: '1', successor: '2' }, { cik: '2' }];
  const once = applySuccessors({ gurus: { 1: pred, 2: own } }, gurus);
  const twice = applySuccessors(once, gurus);
  assert.deepEqual(twice.gurus['2'], once.gurus['2']);
  assert.equal(once.own['2'], own);
  assert.equal(once.gurus['2'].quarters.length, 2);
});
