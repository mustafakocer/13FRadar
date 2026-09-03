import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cached, TTL } from '../api/_lib/cache.js';
import { list13F, getFilingHoldings, aggregatePositions, valueMultiplier } from '../api/_lib/sec.js';

const sub = { filings: { recent: {
  form:            ['13F-HR/A',  '13F-HR',    '13F-HR/A',  '13F-HR',    '13F-HR',    '10-K'],
  accessionNumber: ['A-Q1-AM',   'A-Q2',      'A-Q1-AM0',  'A-Q1',      'A-Q0',      'X'],
  filingDate:      ['2025-08-20','2025-08-14','2025-06-01','2025-05-15','2025-02-14','2025-03-01'],
  reportDate:      ['2025-03-31','2025-06-30','2025-03-31','2025-03-31','2024-12-31','2024-12-31'],
}}};

test('list13F: one entry per period, amendments attached, newest period first', () => {
  const fl = list13F(sub);
  assert.deepEqual(fl.map((f) => f.reportDate), ['2025-06-30', '2025-03-31', '2024-12-31']);
  const q1 = fl[1];
  assert.equal(q1.acc, 'A-Q1');
  assert.equal(q1.form, '13F-HR');
  assert.equal(q1.amended, true);
  assert.deepEqual(q1.amendments.map((a) => a.acc), ['A-Q1-AM0', 'A-Q1-AM']);
  assert.equal(fl[0].amended, false);
  assert.deepEqual(list13F(null), []);
});

test('aggregatePositions: put/call keyed separately, pre-2023 values in thousands, zero rows tolerated', () => {
  const rows = [
    { cusip: 'aaa', value: '100', shrsOrPrnAmt: { sshPrnamt: '10' }, nameOfIssuer: 'A' },
    { cusip: 'AAA', value: '50', shrsOrPrnAmt: { sshPrnamt: '5' }, putCall: 'Put' },
    { cusip: 'AAA', value: '', shrsOrPrnAmt: {} },
  ];
  const r = aggregatePositions(rows, '2022-11-14');
  assert.equal(valueMultiplier('2022-11-14'), 1000);
  assert.equal(valueMultiplier('2023-01-03'), 1);
  assert.equal(r.aum, 150e3);
  assert.equal(r.positions.length, 2);
  assert.equal(r.positions[0].cusip, 'AAA');
  assert.equal(r.positions[0].shares, 10);
  assert.ok(Math.abs(r.positions.reduce((s, p) => s + p.weight, 0) - 100) < 1e-9);
});

test('getFilingHoldings: NEW HOLDINGS merges, RESTATEMENT replaces, heuristic fallback', async () => {
  const cik = '1067983';
  const rows = (arr) => arr.map(([cusip, value, shares, name]) => ({ cusip, value, nameOfIssuer: name, shrsOrPrnAmt: { sshPrnamt: shares } }));
  const base = aggregatePositions(rows([['AAPL0', 100e9, 900e6, 'APPLE'], ['KO000', 25e9, 400e6, 'COCA COLA']]), '2025-05-15');
  const newH = aggregatePositions(rows([['CB000', 6e9, 27e6, 'CHUBB'], ['AAPL0', 1e9, 9e6, 'APPLE']]), '2025-06-01');
  const restated = aggregatePositions(rows([['AAPL0', 90e9, 800e6, 'APPLE']]), '2025-08-20');
  await cached(`hold:${cik}:A-Q1`, TTL.DAY_7, () => base);
  await cached(`hold:${cik}:A-Q1-AM0`, TTL.DAY_7, () => newH);
  await cached(`hold:${cik}:A-Q1-AM`, TTL.DAY_7, () => restated);
  await cached(`amtype:${cik}:A-Q1-AM0`, TTL.DAY_7, () => 'NEW HOLDINGS');
  await cached(`amtype:${cik}:A-Q1-AM`, TTL.DAY_7, () => null);
  const q1 = list13F(sub)[1];

  const m1 = await getFilingHoldings(cik, { ...q1, amendments: [q1.amendments[0]] });
  assert.equal(m1.aum, 132e9);
  assert.equal(m1.positions.find((p) => p.cusip === 'AAPL0').shares, 909e6);
  assert.equal(m1.positions.length, 3);
  assert.equal(base.aum, 125e9, 'base must not be mutated');

  const m2 = await getFilingHoldings(cik, q1);
  assert.equal(m2.aum, 90e9);
  assert.equal(m2.positions.length, 1);
});
