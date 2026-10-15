import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fundFlags } from '../api/_lib/fundFlags.js';

const rows = [
  { cik: '0000000001', acc: 'a-1', aum: 300, declared: 100 },
  { cik: '0000000002', acc: 'b-2', aum: 50, declared: 80 },
  { cik: '0000000003', acc: 'c-2', aum: 98, declared: 100 },
  { cik: '0000000004', acc: 'd-2', aum: 10, declared: 20 },
  { cik: '0000000005', acc: 'e-1', aum: 70, declared: 90 },
];

test('fundFlags: a hand-checked note wins, an unchecked deviation is under review, a small gap carries nothing', () => {
  const { byCik } = fundFlags({
    rows,
    deviations: [
      { cik: '0000000001', acc: 'a-1', aum: 300, declared: 100 },
      { cik: '0000000002', acc: 'b-2', aum: 50, declared: 80 },
      { cik: '0000000003', acc: 'c-2', aum: 98, declared: 100 },
      { cik: '5', acc: 'e-1', aum: 70, declared: 90 },
    ],
    notes: [
      { cik: '1', acc: 'a-1', kind: 'cover-total', declared: 100, table: 300 },
      // a note on an older filing: says nothing about the one shown now
      { cik: '0000000004', acc: 'd-1', kind: 'incomplete-table', declared: 20, table: 10 },
    ],
    reviewed: [{ cik: '0000000003', acc: 'c-2', kind: 'small-gap' }],
  });
  assert.deepEqual(byCik['0000000001'], { acc: 'a-1', kind: 'cover-total', declared: 100, table: 300 });
  assert.deepEqual(byCik['0000000002'], { acc: 'b-2', kind: 'review', declared: 80, table: 50 });
  assert.equal(byCik['0000000003'], undefined);
  assert.equal(byCik['0000000004'], undefined);
  assert.equal(byCik['0000000005'].kind, 'review'); // CIK padded
  assert.deepEqual(fundFlags().byCik, {});
});

test('fundFlags: a deviation on a filing the universe no longer shows is not a badge', () => {
  const { byCik } = fundFlags({ rows, deviations: [{ cik: '0000000002', acc: 'b-1', aum: 1, declared: 2 }] });
  assert.equal(byCik['0000000002'], undefined);
});

test('fund-flags: written by the nightly check, committed by the universe workflow, read by the lists and the fund page', () => {
  const src = fs.readFileSync(new URL('../scripts/check-universe-audit.mjs', import.meta.url), 'utf8');
  assert.match(src, /fund-flags\.json/);
  const wf = fs.readFileSync(new URL('../.github/workflows/universe.yml', import.meta.url), 'utf8');
  assert.match(wf, /client\/public\/fund-flags\.json/);
  for (const page of ['Screen', 'Filers']) {
    assert.match(fs.readFileSync(new URL(`../client/src/pages/${page}.jsx`, import.meta.url), 'utf8'), /FundFlagBadge/);
  }
  assert.match(fs.readFileSync(new URL('../client/src/pages/Manager.jsx', import.meta.url), 'utf8'), /manager\.underReview/);
  const flags = JSON.parse(fs.readFileSync(new URL('../client/public/fund-flags.json', import.meta.url), 'utf8'));
  for (const f of Object.values(flags.byCik)) assert.ok(['cover-total', 'incomplete-table', 'review'].includes(f.kind));
});
