import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import './helpers.mjs';
import { annotateAum, attachFlows, aumHistoryFromGuru, managerStatsFromGuru } from '../api/_lib/managerHistory.js';
import { snapshotEntry } from '../api/_lib/latestHoldings.js';
import { invoke } from '../api/_lib/ssr/invoke.js';

// The manager page's history cards, answered from the nightly history file
// instead of eight to twelve EDGAR reads per view; and the free portfolio
// view answered from the snapshot the universe build keeps.

const fixture = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'tests', 'fixtures', 'guru-history.fixture.json'), 'utf8'));
const brk = fixture.gurus['0001067983'];

test('AUM history comes off the stored quarters, oldest first, with the changes computed', () => {
  const h = aumHistoryFromGuru(brk, 12);
  assert.equal(h.length, brk.quarters.length);
  assert.equal(h[0].reportDate, brk.quarters[0].reportDate);
  assert.equal(h[h.length - 1].acc, '0000950123-26-008001');
  assert.equal(h[h.length - 1].positions, 11);
  assert.equal(h[0].qoq, null, 'nothing before the first quarter');
  const last = h[h.length - 1];
  const prev = h[h.length - 2];
  assert.equal(last.qoq.toFixed(3), (((last.aum - prev.aum) / prev.aum) * 100).toFixed(3));
  assert.equal(aumHistoryFromGuru(null), null, 'a filer outside the curated set takes the EDGAR path');
  assert.equal(aumHistoryFromGuru(brk, 1).length, 1);
});

test('year-over-year needs the same quarter a year earlier', () => {
  const h = annotateAum([
    { reportDate: '2025-06-30', aum: 100 },
    { reportDate: '2025-09-30', aum: 110 },
    { reportDate: '2026-06-30', aum: 150 },
  ]);
  assert.equal(h[2].yoy, 50);
  assert.equal(h[1].yoy, null);
});

test('flows are estimated against the benchmark, and stay null without one', () => {
  const h = [
    { reportDate: '2026-03-31', aum: 100 },
    { reportDate: '2026-06-30', aum: 120 },
  ];
  const spyAt = (d) => (d === '2026-03-31' ? 500 : 550);
  attachFlows(h, spyAt);
  assert.equal(h[1].spyRet.toFixed(2), '10.00');
  assert.equal(h[1].estFlow.toFixed(2), (120 - 100 * 1.1).toFixed(2));
  assert.equal(h[0].estFlow, null);
  attachFlows(h, null);
  assert.equal(h[1].estFlow, null);
  assert.equal(h[1].spyRet, null);
});

test('portfolio stats come off the stored quarters and positions', () => {
  const s = managerStatsFromGuru(brk);
  assert.equal(s.quarters, brk.quarters.length);
  assert.equal(s.turnoverLatest, brk.quarters[brk.quarters.length - 1].turnover);
  assert.ok(s.avgHoldingQuarters >= 1);
  assert.equal(typeof s.newCount, 'number');
  assert.equal(typeof s.exitCount, 'number');
  assert.equal(s.source, 'guru-history');
  assert.deepEqual(managerStatsFromGuru({ quarters: [brk.quarters[0]], positions: {} }), { quarters: 1 }, 'one quarter is not a history');
});

test('new and exited names are counted between the last two quarters', () => {
  const guru = {
    quarters: [
      { reportDate: '2026-03-31', turnover: null },
      { reportDate: '2026-06-30', turnover: 12.5 },
    ],
    positions: {
      A: { series: [['2026-03-31', 1, 100, 50], ['2026-06-30', 1, 100, 50]] },
      B: { series: [['2026-03-31', 1, 100, 50]] },
      C: { series: [['2026-06-30', 1, 100, 50]] },
      D: { series: [['2026-06-30', 1, 50, 25]] },
    },
  };
  const s = managerStatsFromGuru(guru);
  assert.equal(s.newCount, 2);
  assert.equal(s.exitCount, 1);
  assert.equal(s.turnoverLatest, 12.5);
  assert.equal(s.turnoverAvg, 12.5);
  assert.equal(s.avgHoldingQuarters, 1.33, 'A held two quarters, C and D one; rounded to two places');
});

test('the snapshot entry keeps the ten largest rows and the true totals', () => {
  const positions = Array.from({ length: 14 }, (_, i) => ({
    cusip: `C${i}`,
    putCall: i === 3 ? 'Put' : '',
    issuer: `Issuer ${i}`,
    class: 'COM',
    value: 1000 - i * 10 + 0.4,
    shares: 10 + 0.6,
    weight: 7.12345,
  }));
  const e = snapshotEntry({ acc: '0000000000-26-000001', filed: '2026-08-14', aum: 12345.6, positions });
  assert.equal(e.count, 14);
  assert.equal(e.aum, 12346);
  assert.equal(e.top.length, 10);
  assert.equal(e.top[0].value, 1000);
  assert.equal(e.top[0].shares, 11);
  assert.equal(e.top[0].weight, 7.123);
  assert.equal(e.top[3].putCall, 'Put');
  assert.equal('putCall' in e.top[0], false, 'empty fields are not stored seven thousand times');
});

test('the free holdings view answers from the snapshot without reading the filing', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snap-'));
  const file = path.join(dir, 'latest-holdings.json');
  const acc = '0000950123-26-008001';
  const positions = Array.from({ length: 12 }, (_, i) => ({
    cusip: `03783310${i}`,
    putCall: '',
    issuer: `Issuer ${i}`,
    class: 'COM',
    value: 1e9 - i * 1e7,
    shares: 1e6,
    weight: 8 - i * 0.5,
  }));
  fs.writeFileSync(file, JSON.stringify({ updatedAt: 'x', byCik: { '0001067983': snapshotEntry({ acc, filed: '2026-08-14', aum: 1.2e10, positions }) } }));
  process.env.LATEST_HOLDINGS_FILE = file;
  const { default: holdings } = await import('../api/_handlers/holdings.js');
  const r = await invoke(holdings, { cik: '1067983', acc, light: '1' });
  assert.equal(r.status, 200);
  assert.equal(r.body.count, 12, 'the true count, not the ten rows shipped');
  assert.equal(r.body.locked, true);
  assert.equal(r.body.positions.length, 10);
  assert.equal(r.body.aum, 1.2e10);
  assert.equal(r.body.reportDate, '2026-06-30', 'the period still comes from the submissions feed');
  // another accession than the snapshot's is read from the filing as before
  const other = await invoke(holdings, { cik: '1067983', acc: '0000950123-26-005001', light: '1' });
  assert.equal(other.status, 200);
  assert.notEqual(other.body.aum, 1.2e10);
});
