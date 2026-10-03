// A filing that carries another filer's table (Sixth Street / Schwab, 2026-Q2)
// is left out of every ranking and total, and its page says so.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { misfiledBooks, misfiledFor, markMisfiled } from '../api/_lib/misfiledBooks.js';
import { summarizeUniverse } from '../api/_lib/universeSummary.js';

const SIXTH = '0001812095';
const ACC = '0001752724-26-000051';

test('config: Sixth Street 2026-Q2 carries Schwab\'s table, its own cover declares $579.2M', () => {
  const f = misfiledFor(SIXTH, ACC);
  assert.ok(f);
  assert.equal(f.copyOf, '0000884546');
  assert.equal(f.declared, 579182557);
  // only that filing: a later, correct filing is not affected
  assert.equal(misfiledFor(SIXTH, '0001752724-26-000099'), null);
  assert.ok(misfiledBooks.every((b) => /^\d{10}$/.test(b.cik) && b.acc));
});

test('markMisfiled: stamps the named filing, clears a stale stamp', () => {
  const rows = [
    { cik: SIXTH, acc: ACC, aum: 751324855440, positions: 3439 },
    { cik: '0000884546', acc: '0000884546-26-000010', aum: 751324855440, positions: 3439 },
    { cik: '0000000001', acc: 'x', aum: 1, misfiled: { copyOf: 'y' } },
  ];
  assert.equal(markMisfiled(rows), 1);
  assert.equal(rows[0].misfiled.copyOf, '0000884546');
  assert.equal(rows[0].misfiled.declared, 579182557);
  assert.equal(rows[1].misfiled, undefined);
  assert.equal(rows[2].misfiled, undefined);
});

test('summarizeUniverse: a misfiled row is not in the total even when its book is not identical', () => {
  const rows = [
    { cik: '0000884546', aum: 1000, positions: 10, reportDate: '2026-06-30' },
    { cik: SIXTH, aum: 999, positions: 10, reportDate: '2026-06-30', misfiled: { copyOf: '0000884546' } },
  ];
  const s = summarizeUniverse(rows, { asOf: '2026-09-30' });
  assert.equal(s.inTotal, 1);
  assert.equal(s.totalAum, 1000);
});

test('universe.json: Sixth Street is stamped, and no other row is', () => {
  const U = JSON.parse(fs.readFileSync(new URL('../client/public/universe.json', import.meta.url), 'utf8'));
  const stamped = U.rows.filter((r) => r.misfiled);
  for (const r of stamped) assert.ok(misfiledFor(r.cik, r.acc), r.cik);
  const sixth = U.rows.find((r) => r.cik === SIXTH);
  if (sixth?.acc === ACC) assert.ok(sixth.misfiled);
});

test('every size listing leaves a misfiled row out', () => {
  const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
  assert.match(read('client/src/pages/Screen.jsx'), /if \(r\.misfiled\) return false;/);
  assert.match(read('api/_handlers/calendar.js'), /!r\.misfiled/);
  assert.match(read('api/_handlers/emerging.js'), /!r\.misfiled/);
  assert.match(read('scripts/build-universe.mjs'), /if \(!misfiledFor\(e\.cik, snap\.acc\)\) for \(const p of positions\)/);
  assert.match(read('scripts/build-universe.mjs'), /markMisfiled\(rows\)/);
  assert.match(read('scripts/repair-units.mjs'), /markMisfiled\(U\.rows\)/);
  assert.match(read('client/src/pages/Manager.jsx'), /t\('manager\.misfiled'\)/);
});

test('config: Kingsbury 2026-Q2 carries KMT Wealth\'s table; its 2026-Q1 filing of the same day is not touched', () => {
  const f = misfiledFor('0001927315', '0001104659-26-100644');
  assert.ok(f);
  assert.equal(f.copyOf, '0002058235');
  assert.equal(f.declared, null, 'the cover total was copied too: Kingsbury\'s own Q2 total is unknown');
  assert.equal(misfiledFor('0001927315', '0001104659-26-100714'), null, 'its own 2026-03-31 book');
  const rows = [{ cik: '0001927315', acc: '0001104659-26-100644', aum: 118195925, positions: 121 }];
  markMisfiled(rows);
  assert.deepEqual([rows[0].misfiled.copyOf, rows[0].misfiled.declared], ['0002058235', null]);
});

test('pageFiling: a misfiled newest quarter opens the page on the newest valid one, never another filer', async () => {
  const { pageFiling } = await import('../api/_lib/misfiledBooks.js');
  const K = '0001927315';
  const filings = [
    { acc: '0001104659-26-100644', reportDate: '2026-06-30' },
    { acc: '0001104659-26-100714', reportDate: '2026-03-31' },
    { acc: '0001104659-22-116938', reportDate: '2022-09-30' },
  ];
  const p = pageFiling(K, filings);
  assert.equal(p.acc, '0001104659-26-100714');
  assert.deepEqual(p.fallback, { reportDate: '2026-03-31', misfiled: { reportDate: '2026-06-30', acc: '0001104659-26-100644', copyOf: '0002058235', copyOfName: 'KMT Wealth Management, LLC' } });
  // Sixth Street: the same rule
  const s = pageFiling(SIXTH, [{ acc: ACC, reportDate: '2026-06-30' }, { acc: '0001752724-26-000020', reportDate: '2026-03-31' }]);
  assert.deepEqual([s.acc, s.fallback.misfiled.copyOf], ['0001752724-26-000020', '0000884546']);
  // a valid newest filing: no fallback; only a misfiled one and nothing earlier: no fallback
  assert.deepEqual(pageFiling(K, [{ acc: 'x-new', reportDate: '2026-09-30' }, ...filings]), { acc: 'x-new', fallback: null });
  assert.deepEqual(pageFiling(K, filings.slice(0, 1)), { acc: '0001104659-26-100644', fallback: null });
});
