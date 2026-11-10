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
  assert.match(read('scripts/build-universe.mjs'), /if \(!misfiledFor\(e\.cik, snap\.acc, undefined, snap\.amendments\)\) for \(const p of positions\)/);
  assert.match(read('scripts/build-universe.mjs'), /markMisfiled\(rows\)/);
  assert.match(read('scripts/repair-units.mjs'), /markMisfiled\(U\.rows\)/);
  assert.match(read('client/src/pages/Manager.jsx'), /t\('manager\.misfiled'\)/);
});

test('config: KMT Wealth 2026-Q2 carries Kingsbury\'s table; Kingsbury\'s own filings are not touched', () => {
  const f = misfiledFor('0002058235', '0001104659-26-091013');
  assert.ok(f);
  assert.equal(f.copyOf, '0001927315');
  assert.equal(f.declared, null, 'the cover total was copied too: KMT\'s own Q2 total is unknown');
  assert.equal(misfiledFor('0002058235', '0001104659-26-059198'), null, 'its own 2026-03-31 book');
  // Kingsbury's Q1, Q2 and Q3 are one continuous book (corrected 2026-10-22)
  for (const acc of ['0001104659-26-100714', '0001104659-26-100644', '0001104659-26-117244']) assert.equal(misfiledFor('0001927315', acc), null, acc);
  const rows = [{ cik: '0002058235', acc: '0001104659-26-091013', aum: 118195925, positions: 121 }];
  markMisfiled(rows);
  assert.deepEqual([rows[0].misfiled.copyOf, rows[0].misfiled.declared], ['0001927315', null]);
});

test('pageFiling: a misfiled newest quarter opens the page on the newest valid one, never another filer', async () => {
  const { pageFiling } = await import('../api/_lib/misfiledBooks.js');
  const K = '0002058235';
  const filings = [
    { acc: '0001104659-26-091013', reportDate: '2026-06-30' },
    { acc: '0001104659-26-059198', reportDate: '2026-03-31' },
    { acc: '0001104659-26-010767', reportDate: '2025-12-31' },
  ];
  const p = pageFiling(K, filings);
  assert.equal(p.acc, '0001104659-26-059198');
  assert.deepEqual(p.fallback, { reportDate: '2026-03-31', misfiled: { reportDate: '2026-06-30', acc: '0001104659-26-091013', copyOf: '0001927315', copyOfName: 'Kingsbury Capital Investment Advisors LLC' } });
  // Sixth Street: the same rule
  const s = pageFiling(SIXTH, [{ acc: ACC, reportDate: '2026-06-30' }, { acc: '0001752724-26-000020', reportDate: '2026-03-31' }]);
  assert.deepEqual([s.acc, s.fallback.misfiled.copyOf], ['0001752724-26-000020', '0000884546']);
  // a valid newest filing: no fallback; only a misfiled one and nothing earlier: no fallback
  assert.deepEqual(pageFiling(K, [{ acc: 'x-new', reportDate: '2026-09-30' }, ...filings]), { acc: 'x-new', fallback: null });
  assert.deepEqual(pageFiling(K, filings.slice(0, 1)), { acc: '0001104659-26-091013', fallback: null });
});

// ---- a filer that files again after a misfiled quarter ------------------------
// KMT Wealth on 2026-11-10, as list13F() answers EDGAR's feed: a 13F-HR for
// 2026-09-30 and, two minutes later, a 13F-HR/A restating 2026-06-30 as its
// own book. scripts/check-site.mjs failed that day because it expected the
// fallback forever.
const KMT = '0002058235';
const KMT_BAD = '0001104659-26-091013';
const KMT_FIX = '0001104659-26-125011';
const KMT_Q3 = '0001104659-26-125007';
const period = (acc, filingDate, reportDate, amendments = []) => ({ acc, form: '13F-HR', filingDate, reportDate, amended: amendments.length > 0, baseIsAmendment: false, amendments });
const kmtAfter = [
  period(KMT_Q3, '2026-11-10', '2026-09-30'),
  period(KMT_BAD, '2026-08-05', '2026-06-30', [{ acc: KMT_FIX, form: '13F-HR/A', filingDate: '2026-11-10' }]),
  period('0001104659-26-059198', '2026-05-12', '2026-03-31'),
  period('0001104659-26-010767', '2026-02-05', '2025-12-31'),
];
const kmtBefore = [period(KMT_BAD, '2026-08-05', '2026-06-30'), ...kmtAfter.slice(2)];
const entryOf = (cik, acc) => misfiledBooks.find((b) => b.cik === cik && b.acc === acc);

test('config: KMT restated its 2026-06-30 book on 2026-11-10; the entry names the amendment', () => {
  const e = entryOf(KMT, KMT_BAD);
  assert.equal(e.correctedBy, KMT_FIX);
  assert.match(e.reason, /corrected it on 2026-11-10/);
  // every correctedBy is an accession, and never the misfiled filing itself
  for (const b of misfiledBooks) if (b.correctedBy != null) assert.ok(/^\d{10}-\d{2}-\d{6}$/.test(b.correctedBy) && b.correctedBy !== b.acc, b.cik);
  // Sixth Street and Schear carry no such field: their entries stand as filed
  assert.equal(entryOf(SIXTH, ACC).correctedBy, undefined);
});

test('misfiledFor: the entry stands for the original alone, and lapses once the filer\'s restatement is applied', async () => {
  const { corrected, lacksCorrection } = await import('../api/_lib/misfiledBooks.js');
  const e = entryOf(KMT, KMT_BAD);
  assert.ok(misfiledFor(KMT, KMT_BAD), 'a bare accession: the document is Kingsbury\'s table');
  assert.ok(misfiledFor(KMT, KMT_BAD, undefined, []), 'no amendment applied');
  assert.ok(misfiledFor(KMT, KMT_BAD, undefined, [{ acc: '0001104659-26-999999' }]), 'some other amendment is not the correction');
  // the three shapes amendments come in: list13F's, a snapshot's, a universe row's
  assert.equal(misfiledFor(KMT, KMT_BAD, undefined, kmtAfter[1].amendments), null);
  assert.equal(misfiledFor(KMT, KMT_BAD, undefined, [{ acc: KMT_FIX, filingDate: '2026-11-10', type: 'RESTATEMENT' }]), null);
  assert.equal(misfiledFor(KMT, KMT_BAD, undefined, [KMT_FIX]), null);
  assert.equal(corrected(e, [KMT_FIX]), true);
  assert.equal(corrected(entryOf(SIXTH, ACC), [{ acc: '0001752724-26-000055' }]), false, 'an amendment nobody entered as the correction changes nothing');
  // what may be served under the misfiled accession
  assert.equal(lacksCorrection(KMT, KMT_BAD, null), true, 'a snapshot stored before the amendment');
  assert.equal(lacksCorrection(KMT, KMT_BAD, [{ acc: KMT_FIX }]), false);
  assert.equal(lacksCorrection(KMT, KMT_Q3, null), false, 'another filing of the same filer');
  assert.equal(lacksCorrection(SIXTH, ACC, null), false, 'an entry without correctedBy is served as EDGAR has it, under its banner');
});

test('pageFiling: a newer valid filing after a misfiled one opens the page there, with no fallback', async () => {
  const { pageFiling, misfiledAmong } = await import('../api/_lib/misfiledBooks.js');
  // before 2026-11-10: the misfiled quarter is the newest, the page falls back to 2026-03-31
  const before = pageFiling(KMT, kmtBefore);
  assert.equal(before.acc, '0001104659-26-059198');
  assert.equal(before.fallback.misfiled.acc, KMT_BAD);
  assert.equal(misfiledAmong(KMT, kmtBefore).acc, KMT_BAD);
  // after: the 2026-09-30 filing, and nothing left to say about 2026-06-30
  assert.deepEqual(pageFiling(KMT, kmtAfter), { acc: KMT_Q3, fallback: null });
  assert.equal(misfiledAmong(KMT, kmtAfter), null, 'the restated quarter is KMT\'s own: no banner on it');
  // the same with the amendment not entered as a correction: the newer filing
  // still retires the fallback; the old quarter keeps its banner
  const plain = [{ cik: KMT, acc: KMT_BAD, copyOf: '0001927315', copyOfName: 'Kingsbury' }];
  assert.deepEqual(pageFiling(KMT, kmtAfter, plain), { acc: KMT_Q3, fallback: null });
  assert.equal(misfiledAmong(KMT, kmtAfter, plain).acc, KMT_BAD);
  // the restatement arrives before any newer quarter: the page opens on the restated quarter itself
  assert.deepEqual(pageFiling(KMT, kmtAfter.slice(1)), { acc: KMT_BAD, fallback: null });
  // a misfiled newest quarter falls back past an older misfiled one, but stops at a restated one
  const two = [...plain, { cik: KMT, acc: KMT_Q3, copyOf: '0000000009', copyOfName: 'Other' }];
  assert.equal(pageFiling(KMT, kmtAfter, two).acc, '0001104659-26-059198', 'both uncorrected: back to 2026-03-31');
  const twoFixed = [{ ...plain[0], correctedBy: KMT_FIX }, two[1]];
  const p = pageFiling(KMT, kmtAfter, twoFixed);
  assert.deepEqual([p.acc, p.fallback.reportDate, p.fallback.misfiled.acc], [KMT_BAD, '2026-06-30', KMT_Q3]);
});

test('misfiledState: what the site check holds each entry to', async () => {
  const { misfiledState } = await import('../api/_lib/misfiledBooks.js');
  const e = entryOf(KMT, KMT_BAD);
  const state = (entry, filings, books) => misfiledState(entry, filings, books).state;
  assert.equal(state(e, kmtBefore), 'fallback');
  const after = misfiledState(e, kmtAfter);
  assert.deepEqual([after.state, after.newer.acc, after.filing.acc, after.corrected], ['retired', KMT_Q3, KMT_BAD, true]);
  assert.equal(state(e, kmtAfter.slice(1)), 'corrected', 'restated, no later period yet');
  assert.equal(state(e, kmtBefore.slice(0, 1)), 'only', 'nothing older to fall back to');
  assert.equal(state(e, kmtAfter.slice(2)), 'absent');
  assert.equal(state(e, []), 'absent');
  // an entry nobody corrected is retired by the next quarter all the same
  const plain = { cik: KMT, acc: KMT_BAD, copyOf: '0001927315' };
  const r = misfiledState(plain, kmtAfter, [plain]);
  assert.deepEqual([r.state, r.corrected], ['retired', false]);
  // Sixth Street and Schear today: the misfiled quarter is still the newest
  const sixth = [period(ACC, '2026-08-14', '2026-06-30', [{ acc: '0001752724-26-000055', form: '13F-HR/A', filingDate: '2026-08-14' }]), period('0001752724-26-000034', '2026-05-15', '2026-03-31')];
  assert.equal(state(entryOf(SIXTH, ACC), sixth), 'fallback');
  const schear = [period('0001962838-26-000005', '2026-10-14', '2026-09-30'), period('0001962838-26-000003', '2026-07-27', '2026-06-30')];
  assert.equal(state(entryOf('0001962838', '0001962838-26-000005'), schear), 'fallback');
  // the site check reads its filers from the list, not from two CIKs in the script
  const src = fs.readFileSync(new URL('../scripts/check-site.mjs', import.meta.url), 'utf8');
  assert.match(src, /for \(const entry of misfiledBooks\)/);
  assert.match(src, /misfiledState\(entry, filings\)/);
  assert.doesNotMatch(src, /\['0002058235', 'KMT Wealth'\]/);
});

test('markMisfiled: a row or reference quarter read with the restatement applied is not stamped', () => {
  const rows = [
    // the nightly build after 2026-11-10: the newest period, the restated quarter as its reference
    { cik: KMT, acc: KMT_Q3, reportDate: '2026-09-30', aum: 216079457, ref: { reportDate: '2026-06-30', acc: KMT_BAD, amendedBy: [KMT_FIX], aum: 210630047, positions: 18 } },
    // the row as stored before the amendment: Kingsbury's 121 lines
    { cik: KMT, acc: KMT_BAD, reportDate: '2026-06-30', aum: 118195925, positions: 121 },
    // the restated quarter as a row of its own
    { cik: KMT, acc: KMT_BAD, amendedBy: [KMT_FIX], reportDate: '2026-06-30', aum: 210630047, positions: 18, misfiled: { copyOf: 'stale' } },
    // a reference quarter read without it stays out
    { cik: KMT, acc: KMT_Q3, reportDate: '2026-09-30', aum: 216079457, ref: { reportDate: '2026-06-30', acc: KMT_BAD, aum: 118195925, positions: 121 } },
  ];
  assert.equal(markMisfiled(rows), 1);
  assert.equal(rows[0].misfiled, undefined);
  assert.equal(rows[0].ref.misfiled, undefined);
  assert.equal(rows[1].misfiled.copyOf, '0001927315');
  assert.equal(rows[2].misfiled, undefined, 'a stale stamp is cleared');
  assert.ok(rows[3].ref.misfiled);
  // the restated reference quarter counts toward the headline total, the unrestated one does not
  const s = summarizeUniverse([rows[0], rows[3]], { asOf: '2026-11-10' });
  assert.equal(s.totalAum, 210630047);
});

test('universeRow: the applied 13F-HR/A accessions travel with the row and its reference quarter', async () => {
  const { universeRow } = await import('../api/_lib/universeSummary.js');
  const positions = [{ cusip: '922908769', value: 100, weight: 100 }];
  const amendments = [{ acc: KMT_FIX, filingDate: '2026-11-10', type: 'RESTATEMENT', inferred: false, positions: 18 }];
  const row = universeRow({ cik: '2058235', name: 'KMT' }, { acc: KMT_Q3, filed: '2026-11-10', reportDate: '2026-09-30', aum: 100, positions, amendments: null, ref: { reportDate: '2026-06-30', acc: KMT_BAD, filed: '2026-08-05', aum: 90, positions, amendments } });
  assert.equal(row.amendedBy, undefined);
  assert.deepEqual(row.ref.amendedBy, [KMT_FIX]);
  assert.deepEqual(universeRow({ cik: '2058235', name: 'KMT' }, { acc: KMT_BAD, filed: '2026-08-05', reportDate: '2026-06-30', aum: 90, positions, amendments }).amendedBy, [KMT_FIX]);
  const src = fs.readFileSync(new URL('../scripts/build-universe.mjs', import.meta.url), 'utf8');
  assert.match(src, /ref: \{ reportDate: REF, acc: f\.acc, filed: f\.filingDate, aum, positions, amendments: amendments \|\| null \}/);
});
