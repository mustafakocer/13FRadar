import test from 'node:test';
import assert from 'node:assert/strict';
import { findLineSlips, applyLineFixes, autoReview } from '../api/_lib/deviationFix.js';
import { deviationReport } from '../api/_lib/universeAudit.js';

// Advisors Preferred, 2026-Q3 (0001598841-26-000004), cut down: four lines
// written ×10, the cover at $705.6M
const ap = () => [
  { cusip: '74347R206', value: 145090119, shares: 147855, close: null, prevPx: 90.6 }, // QLD: no close, ×10.83 its own last quarter
  { cusip: '921946810', value: 54829672, shares: 57984, close: null, prevPx: 94.95 },
  { cusip: '929089100', value: 20367052, shares: 21073, close: 94.48 },
  { cusip: '74164M108', value: 2790009, shares: 1013, close: 272.39 },
  { cusip: '78462F103', value: 36136137, shares: 46952, close: 769.6 }, // right at the close
  { cusip: '464287457', value: 32548788, shares: 401589, close: null, prevPx: 81.95 }, // right vs last quarter
  { cusip: 'OTHER0000', value: 623726971, shares: 1, close: null }, // the rest of the book, unpriced
];
const AP_COVER = 705639658;

test('findLineSlips: the ×10 lines that reconcile the table with the cover', () => {
  const r = findLineSlips(ap(), { declared: AP_COVER });
  assert.ok(r);
  assert.deepEqual(r.fixes.map((f) => f.cusip).sort(), ['74164M108', '74347R206', '921946810', '929089100']);
  assert.equal(r.fixes.find((f) => f.cusip === '929089100').by, 'close');
  assert.equal(r.fixes.find((f) => f.cusip === '74347R206').by, 'previous-filing');
  assert.ok(r.before > 0.29 && r.after < 0.02 && r.after > 0);
});

test('findLineSlips: never without a cover to reconcile with, or when the cover says otherwise', () => {
  // the table already matches: nothing to correct, ×10-looking lines or not
  const book = ap();
  const aum = book.reduce((s, p) => s + p.value, 0);
  assert.equal(findLineSlips(book, { declared: aum }), null);
  // dividing them would not close the gap (the cover is a typo, not the lines)
  assert.equal(findLineSlips(book, { declared: aum / 10 }), null);
  // table below the cover: missing lines, not ×10 lines
  assert.equal(findLineSlips(book, { declared: aum * 1.5 }), null);
  assert.equal(findLineSlips(book, { declared: null }), null);
});

test('findLineSlips: a priced line is judged on its close only; options and principal never', () => {
  const book = [
    // last quarter ×10 cheaper but at the close now: a real move, left alone
    { cusip: 'A', value: 1000, shares: 10, close: 100, prevPx: 10 },
    { cusip: 'B', putCall: 'Put', value: 9000, shares: 10, close: 90 },
    { cusip: 'C', prn: true, value: 9000, shares: 10, close: 90 },
  ];
  assert.equal(findLineSlips(book, { declared: 2000 }), null);
});

test('applyLineFixes: once, on the line it was made on', () => {
  const agg = { aum: 1150, positions: [{ cusip: 'X', putCall: '', value: 1000, shares: 1 }, { cusip: 'Y', putCall: '', value: 150, shares: 1 }] };
  const fixes = [{ cusip: 'X', putCall: '', value: 1000, factor: 0.1, by: 'close' }];
  const once = applyLineFixes(agg, fixes);
  assert.equal(once.aum, 250);
  assert.equal(once.positions[0].cusip, 'Y'); // re-sorted
  assert.equal(once.positions.find((p) => p.cusip === 'X').lineFix.factor, 0.1);
  assert.equal(agg.aum, 1150); // not mutated
  assert.equal(applyLineFixes(once, fixes), once); // idempotent
  // an amendment changed the line: the correction no longer applies
  const changed = { aum: 1500, positions: [{ cusip: 'X', putCall: '', value: 1400, shares: 1 }] };
  assert.equal(applyLineFixes(changed, fixes), changed);
});

test('autoReview: a cover typo over a table that checks out is closed', () => {
  const greenwich = { aum: 3094044000, declared: 309444, rows: 305, entries: 305, priced: 217, atClose: 216, prevAum: 2743164353, period: '2026-09-30' };
  assert.equal(autoReview(greenwich).kind, 'cover-total');
  // a line count that does not match, prices that do not, a total far from
  // last quarter's, an amendment, or too few prices: a person decides
  assert.equal(autoReview({ ...greenwich, entries: 306 }), null);
  assert.equal(autoReview({ ...greenwich, atClose: 190 }), null);
  assert.equal(autoReview({ ...greenwich, prevAum: 1e9 }), null);
  assert.equal(autoReview({ ...greenwich, prevAum: undefined }), null);
  assert.equal(autoReview({ ...greenwich, amended: true }), null);
  assert.equal(autoReview({ ...greenwich, priced: 4, atClose: 4 }), null);
  // Delta Accumulation: 154 rows against 155, a quarter of its option lines
  // off the close: left for a person
  assert.equal(autoReview({ aum: 2469849605, declared: 16037984, rows: 154, entries: 155, priced: 154, atClose: 128, prevAum: 2501050429 }), null);
});

test('autoReview: a small gap with a clean table is closed, and says when the cover left the options out', () => {
  const r = autoReview({ aum: 132542811, putCallValue: 1414795, declared: 131143455, rows: 90, entries: 90, priced: 54, atClose: 54, prevAum: 118699274, period: '2026-09-30' });
  assert.equal(r.kind, 'small-gap');
  assert.match(r.reason, /without its options lines/);
  assert.equal(autoReview({ aum: 103, declared: 100, rows: 9, entries: 9, priced: 9, atClose: 7 }), null);
  assert.equal(autoReview({ aum: 103, declared: 100, rows: 9, entries: 9, priced: 9, atClose: 9 }), null); // 3% is a person's call
});

test('deviationReport: automatic closings and line fixes are listed apart', () => {
  const devs = [
    { cik: '0000000001', name: 'A', acc: 'a-1', rank: 1, aum: 3e9, declared: 3e5, diffPct: 999900 },
    { cik: '0000000002', name: 'B', acc: 'b-1', rank: 2, aum: 2e9, declared: 1e9, diffPct: 100 },
  ];
  const md = deviationReport(devs, {
    quarter: '2026-06-30',
    auto: [{ cik: '0000000001', acc: 'a-1', kind: 'cover-total' }],
    lineFixes: [{ cik: '0000000003', name: 'C', acc: 'c-1', before: 0.297, after: 0.013, lines: [{ cusip: 'X', issuer: 'X CORP', value: 1e8, factor: 0.1, by: 'close', ratio: 10.2 }] }],
  });
  assert.match(md, /İncelenecek: 1 fon/);
  assert.match(md, /## Otomatik kapatıldı — fonun kapak hatası/);
  assert.match(md, /## Otomatik düzeltildi/);
  assert.match(md, /\| C \(0000000003\) \| X CORP \(X\) \| \$100\.0 mn \| \$10\.0 mn \| kapanışın 10\.2× \| \+29\.7% → \+1\.3% \|/);
});
