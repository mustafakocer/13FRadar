import test from 'node:test';
import assert from 'node:assert/strict';
import { sectorSlices } from '../client/src/lib/sectorSlices.js';

// #9 — the sector donut: every position is in the total, the unknown ones in
// one "Unclassified" slice, and the legend adds up to 100%.
const sum = (data) => data.reduce((s, d) => s + d.value, 0);

test('unknown sectors, ETFs and unresolved CUSIPs go to Unclassified; total is 100%', () => {
  const positions = [
    { ticker: 'AAPL', weight: 40 },
    { ticker: 'SPCX', weight: 30 }, // ETF: the sector map says 'ETF', the API says null
    { ticker: null, cusip: 'H1467J104', weight: 20 },
    { ticker: 'XOM', weight: 10 },
  ];
  const { data, coverage } = sectorSlices(positions, { AAPL: 'Technology', SPCX: null, XOM: 'Energy' });
  assert.deepEqual(
    data.map((d) => [d.name, Math.round(d.value)]),
    [['Technology', 40], ['Energy', 10], ['Unclassified', 50]]
  );
  assert.ok(Math.abs(sum(data) - 100) < 0.1);
  assert.equal(coverage, 50);
});

test('string and percentage-string weights and sector objects are coerced, not dropped', () => {
  const positions = [
    { ticker: 'A', weight: '39.2%' },
    { ticker: 'B', weight: '60.8' },
    { ticker: 'C', weight: 'n/a' },
  ];
  const { data } = sectorSlices(positions, { A: { sector: 'Technology' }, B: 'ETF' });
  assert.deepEqual(data.map((d) => d.name), ['Technology', 'Unclassified']);
  assert.ok(Math.abs(sum(data) - 100) < 0.1);
  // a percentage string is not a sector name
  const odd = sectorSlices([{ ticker: 'K', weight: 5 }], { K: '39.2%' });
  assert.deepEqual(odd.data.map((d) => d.name), ['Unclassified']);
});

test('more than eight sectors fold into Other, Unclassified stays its own slice, still 100%', () => {
  const positions = Array.from({ length: 12 }, (_, i) => ({ ticker: `T${i}`, weight: 12 - i }));
  positions.push({ ticker: 'ETF1', weight: 3 });
  const sectors = Object.fromEntries(positions.map((p, i) => [p.ticker, p.ticker === 'ETF1' ? null : `Sector ${i}`]));
  const { data } = sectorSlices(positions, sectors);
  assert.equal(data.length, 8);
  assert.equal(data[data.length - 1].name, 'Unclassified');
  assert.equal(data[data.length - 2].name, 'Other');
  assert.ok(Math.abs(sum(data) - 100) < 0.1);
  assert.deepEqual(sectorSlices([], {}), { data: [], coverage: 0 });
});
