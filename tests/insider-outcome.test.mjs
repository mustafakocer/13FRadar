// Forward returns vs SPY, filing totals and the redefined "İsabet".
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeOnOrAfter, forwardExcess, hitRate, buysByPerson, annotateOutcomes } from '../api/_lib/insiderOutcome.js';
import { filingTotals, signalLevel } from '../api/_lib/insiderSignal.js';

// a daily series from a start day, one close per calendar day
const series = (start, closes) =>
  closes.map((close, i) => ({ date: new Date(Date.parse(`${start}T00:00:00Z`) + i * 864e5).toISOString().slice(0, 10), close }));
const flat = (start, days, v = 100) => series(start, Array(days).fill(v));

test('forward excess return: stock vs SPY over the horizon, only once it has passed', () => {
  const stock = series('2026-01-01', [...Array(40).fill(10), ...Array(60).fill(12)]); // +20% by day 40
  const spy = flat('2026-01-01', 100, 500); // SPY flat
  assert.equal(forwardExcess(stock, spy, '2026-01-01', 30), 0);
  assert.equal(forwardExcess(stock, spy, '2026-01-01', 90), 20);
  assert.equal(forwardExcess(stock, spy, '2026-02-01', 90), null, 'the horizon runs past the series');
  assert.equal(closeOnOrAfter(stock, '2025-12-25').date, '2026-01-01');
});

test('a buy split into lots is rated on the filing total', () => {
  // a CEO buying $1.2M in 30 lots of $40K: each line alone would be "Zayıf"
  const lots = Array.from({ length: 30 }, (_, i) => ({ a: 'ACC1', k: 'P', r: 'ceo', n: 'Doe John', t: 'X', p: 40, s: 1000, v: 40_000, o: 10_000 + (i + 1) * 1000, d: '2026-09-01', li: i }));
  assert.equal(signalLevel(lots[0]).level, 'weak', 'one line on its own');
  const f = filingTotals(lots).get('ACC1');
  assert.equal(f.value, 1_200_000);
  assert.equal(f.lines, 30);
  assert.equal(Math.round(f.increase), 300, '10,000 → 40,000 shares');
  assert.equal(signalLevel(lots[0], { filing: f }).level, 'strong');
});

test('İsabet: the same person\'s EARLIER buys that beat SPY over 90 days, n ≥ 3', () => {
  const buy = (d, x90, extra = {}) => ({ a: `A-${d}`, k: 'P', p: 10, s: 100, v: 1000, n: 'Doe Jane', ow: '0000000001', t: 'X', d, x90, ...extra });
  const rows = [buy('2025-10-01', 5), buy('2025-11-01', -2), buy('2025-12-01', 8), buy('2026-01-05', 1), buy('2026-09-01', null)];
  const byPerson = buysByPerson(rows);
  assert.deepEqual(hitRate(rows[4], byPerson), { n: 4, hits: 3, rate: 75 });
  assert.deepEqual(hitRate(rows[2], byPerson), { n: 2, insufficient: true }, 'only two earlier buys: not enough');
  // another person's buys never count
  const other = { ...buy('2026-09-02', null), n: 'Roe Rick', ow: '0000000002' };
  assert.deepEqual(hitRate(other, buysByPerson([...rows, other])), { n: 0, insufficient: true });
  // funds: not shown at all
  assert.equal(hitRate({ ...rows[4], n: 'HORIZON KINETICS ASSET MANAGEMENT LLC' }, byPerson), null);
});

test('the build stores x30/x90 on open-market buys only', () => {
  const s = series('2026-01-01', Array(120).fill(10).map((v, i) => (i >= 30 ? 11 : v)));
  const spy = flat('2026-01-01', 120);
  const rows = [
    { t: 'X', k: 'P', p: 10, d: '2026-01-01', a: 'A', s: 1, v: 10 },
    { t: 'X', k: 'M', p: 0.5, d: '2026-01-01', a: 'B', s: 1, v: 0.5 },
  ];
  annotateOutcomes(rows, () => s, spy);
  assert.equal(rows[0].x30, 10);
  assert.equal(rows[0].x90, 10);
  assert.equal(rows[1].x30, undefined, 'an option exercise has no return');
});
