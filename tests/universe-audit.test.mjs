// The universe audit's pure parts, and putCallValue surviving every rebuild.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { compareTotal, overlapPairs, lineKey } from '../api/_lib/universeAudit.js';
import { universeRow, summarizeUniverse } from '../api/_lib/universeSummary.js';
import { datePeriods } from '../scripts/repair-units.mjs';

test('compareTotal: the declared total goes through the same unit factor', () => {
  assert.deepEqual(compareTotal({ ours: 1_000_000, declared: 1000, factor: 1000 }).ok, true);
  const c = compareTotal({ ours: 1_020, declared: 1_000 });
  assert.equal(c.ok, false);
  assert.equal(Math.round(c.diffPct * 100), 2);
  assert.equal(compareTotal({ ours: 1_005, declared: 1_000 }).ok, true);
  assert.equal(compareTotal({ ours: 5, declared: null }).ok, null);
});

test('overlapPairs: the same book under two CIKs is a pair; a similar one is not', () => {
  const lines = (n, from = 0) => Array.from({ length: n }, (_, i) => lineKey({ cusip: `C${i + from}`, shares: 100 + i + from }));
  const books = [
    { id: 'A', keys: lines(40) },
    { id: 'B', keys: [...lines(38), ...lines(2, 500)] }, // 38 of 40 lines the same
    { id: 'C', keys: lines(40, 10) }, // 30 of 40 the same as A
    { id: 'D', keys: lines(5) }, // too small to judge
  ];
  const pairs = overlapPairs(books);
  assert.deepEqual(pairs.map((p) => [p.a, p.b, p.matched]), [['A', 'B', 38]]);
  // same CUSIP, other share count: a different line
  assert.notEqual(lineKey({ cusip: 'X', shares: 100 }), lineKey({ cusip: 'X', shares: 101 }));
  assert.notEqual(lineKey({ cusip: 'X', shares: 100 }), lineKey({ cusip: 'X', putCall: 'Call', shares: 100 }));
});

test('putCallValue: every universe row the build writes carries it, and nothing downstream drops it', () => {
  const snap = {
    acc: '0000000001-26-000001',
    filed: '2026-08-10',
    reportDate: '2026-06-30',
    periodFrom: 'filing-date',
    aum: 1000,
    positions: [
      { cusip: 'A', value: 600, weight: 60 },
      { cusip: 'A', putCall: 'Call', value: 300, weight: 30 },
      { cusip: 'B', putCall: 'Put', value: 100, weight: 10 },
    ],
  };
  const row = universeRow({ cik: '1', name: 'F' }, snap);
  assert.equal(row.putCallValue, 400);
  assert.equal(row.cik, '0000000001');
  // the repair and the summary keep it and use it
  const [after] = datePeriods([row]);
  assert.equal(after.putCallValue, 400);
  const s = summarizeUniverse([after], { asOf: '2026-09-29' });
  assert.equal(s.totalAum, 600);
  assert.equal(s.optionsExcluded, 400);
  // the nightly build writes its rows through universeRow
  const src = fs.readFileSync(new URL('../scripts/build-universe.mjs', import.meta.url), 'utf8');
  assert.match(src, /rows\.push\(universeRow\(e, snap\)\)/);
});

test('putCallValue: the one-off measurement never overwrites a value the build recorded', async () => {
  const src = fs.readFileSync(new URL('../scripts/measure-options.mjs', import.meta.url), 'utf8');
  assert.match(src, /r\.putCallValue != null\) continue;/);
  // and every current row of the committed universe has it
  const U = JSON.parse(fs.readFileSync(new URL('../client/public/universe.json', import.meta.url), 'utf8'));
  const { completeQuarter, inferPeriod } = await import('../api/_lib/universeSummary.js');
  const q = completeQuarter(U.updatedAt);
  const current = U.rows.filter((r) => (r.reportDate || inferPeriod(r.filed)) >= q && r.aum > 0);
  const missing = current.filter((r) => r.putCallValue == null);
  assert.equal(missing.length, 0, `${missing.length} current rows without putCallValue`);
});

test('a book on the reviewed duplicate list is counted once', () => {
  const rows = [
    { cik: '0000000001', aum: 100, positions: 10, reportDate: '2026-06-30', filed: '2026-08-01' },
    { cik: '0000000002', aum: 99, positions: 10, reportDate: '2026-06-30', filed: '2026-08-01' },
  ];
  assert.equal(summarizeUniverse(rows, { asOf: '2026-09-29' }).totalAum, 199);
  const s = summarizeUniverse(rows, { asOf: '2026-09-29', sameBooks: [{ keep: '1', drop: '2' }] });
  assert.equal(s.totalAum, 100);
  assert.equal(s.duplicates, 1);
});

test('effectiveDeclared: a restatement replaces the total, new holdings add to it', async () => {
  const { effectiveDeclared } = await import('../api/_lib/universeAudit.js');
  assert.equal(effectiveDeclared(100, []), 100);
  assert.equal(effectiveDeclared(100, [{ type: 'RESTATEMENT', total: 90 }]), 90);
  // CAZ Investments: the original's $95.9M plus a NEW HOLDINGS amendment
  assert.equal(effectiveDeclared(95.9, [{ type: 'NEW HOLDINGS', total: 357.1 }]), 95.9 + 357.1);
  assert.equal(effectiveDeclared(100, [{ type: 'NEW HOLDINGS', total: null }]), null);
  assert.equal(effectiveDeclared(100, [{ type: null, total: 50 }]), null);
});

test('storedUnitSlip: only an exact factor of 1000 is a unit slip', async () => {
  const { storedUnitSlip } = await import('../api/_lib/universeAudit.js');
  // Betterment: $59,125,356 stored, $59,125,356,000 in a full read
  assert.equal(storedUnitSlip(59125356, 59125356000), 1000);
  assert.equal(storedUnitSlip(59125356000, 59125356), 0.001);
  assert.equal(storedUnitSlip(453007905, 95926025), null);
  assert.equal(storedUnitSlip(0, 5), null);
});

test('apply-audit: a SLIP rescales the stored filing once and marks it', async () => {
  const { parseSlips, applySlips } = await import('../scripts/apply-audit.mjs');
  const log = '2026-09-29T23:00:00Z SLIP 0001633901 0001633901-26-000004 59125356 59125356000 1000\nCMP 0001 1 2 3 1 0 0 0\nSLIP 0000000009 0000000009-26-000001 5 5000 1000';
  const slips = parseSlips(log);
  assert.equal(slips.length, 2);
  const U = { rows: [{ cik: '0001633901', acc: '0001633901-26-000004', aum: 59125356, putCallValue: 0 }, { cik: '0000000009', acc: '0000000009-26-000002', aum: 5 }] };
  const L = { byCik: { '0001633901': { acc: '0001633901-26-000004', aum: 59125356, top: [{ value: 9884311 }] } } };
  const { applied, skipped } = applySlips(slips, U, L);
  assert.equal(applied.length, 1);
  assert.equal(skipped[0].why, 'newer filing');
  assert.equal(U.rows[0].aum, 59125356000);
  assert.equal(L.byCik['0001633901'].top[0].value, 9884311000);
  assert.deepEqual(L.byCik['0001633901'].unitFix, { factor: 1000, by: 'audit-full-table' });
  // a second run leaves it alone
  assert.equal(applySlips(slips, U, L).applied.length, 0);
  // and repair-units does not rescale it again
  const { repairLatest } = await import('../scripts/repair-units.mjs');
  assert.equal(repairLatest(L, U.rows).length, 0);
});

test('declaredCandidates: the chain, the original and each amendment\'s own total', async () => {
  const { declaredCandidates } = await import('../api/_lib/universeAudit.js');
  // Assenagon-like: a NEW HOLDINGS cover carrying the cumulative total
  assert.deepEqual(declaredCandidates(80, [{ type: 'NEW HOLDINGS', total: 80 }]), [160, 80]);
  assert.deepEqual(declaredCandidates(100, []), [100]);
  assert.deepEqual(declaredCandidates(null, [{ type: 'RESTATEMENT', total: 90 }]), [90]);
});

test('totalDeviations: the 500 largest current funds, any reading and unit, misfiled left out', async () => {
  const { totalDeviations, newFindings, pairKey } = await import('../api/_lib/universeAudit.js');
  const q = '2026-06-30';
  const rows = [
    { cik: '0000000001', acc: 'a1', name: 'Fine', aum: 1000, declared: 1004, reportDate: q },
    { cik: '0000000002', acc: 'a2', name: 'Cover in dollars', aum: 900e3, declared: 900, reportDate: q },
    { cik: '0000000003', acc: 'a3', name: 'Cumulative cover', aum: 800, declared: 1600, declaredAlt: [800], reportDate: q },
    { cik: '0000000004', acc: 'a4', name: 'Sanctuary-like', aum: 700, declared: 7000, reportDate: q },
    { cik: '0000000005', acc: 'a5', name: 'Misfiled', aum: 5e6, declared: 1, reportDate: q, misfiled: { copyOf: 'x' } },
    { cik: '0000000006', acc: 'a6', name: 'Stale', aum: 600, declared: 1, reportDate: '2026-03-31' },
    { cik: '0000000007', acc: 'a7', name: 'No cover', aum: 500, reportDate: q },
  ];
  const d = totalDeviations(rows, { quarter: q });
  assert.deepEqual(d.map((x) => x.cik), ['0000000004']);
  assert.equal(totalDeviations(rows, { quarter: q, top: 3 }).length, 0);
  // only what the previous night did not have
  const pairs = [{ a: '0000000009', b: '0000000008', matched: 50, shareA: 1, shareB: 1 }, { a: '0000000010', b: '0000000011', matched: 40, shareA: 0.95, shareB: 0.99 }];
  const fresh = newFindings({ deviations: d, pairs }, { deviations: ['0000000004|a4'], pairs: [pairKey('0000000008', '0000000009')] }, new Set([pairKey('0000000011', '0000000010')]));
  assert.equal(fresh.deviations.length, 0);
  assert.equal(fresh.pairs.length, 0);
  // a new filing of the same filer is new
  assert.equal(newFindings({ deviations: d, pairs: [] }, { deviations: ['0000000004|old'] }).deviations.length, 1);
});

test('check-universe-audit: a fresh deviation exits 3 and is written to the state', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../scripts/check-universe-audit.mjs', import.meta.url), 'utf8');
  assert.match(src, /process\.exit\(3\)/);
  assert.doesNotMatch(src, /misfiled-books\.json['"]\s*,/); // never writes the reviewed list
  const wf = fs.readFileSync(new URL('../.github/workflows/universe.yml', import.meta.url), 'utf8');
  assert.match(wf, /check-universe-audit\.mjs/);
  assert.match(wf, /notify\.mjs --title "13F denetimi/);
  assert.match(wf, /issues: write/);
  assert.match(wf, /api\/_data\/universe-audit\.json/);
  assert.match(wf, /api\/_data\/copy-books\.json/);
});
