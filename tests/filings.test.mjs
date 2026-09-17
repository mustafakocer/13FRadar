import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFilingIndex,
  mergeFilings,
  joinUniverse,
  quarterKey,
  quartersOf,
} from '../api/_lib/filings.js';

// The rolling feed of 13F filings: reading a day's EDGAR index, folding it
// into the stored window, and attaching what the universe scan measured.

const INDEX = `Description:           Daily Index of EDGAR Dissemination Feed by Form Type
Last Data Received:    September 8, 2026

Form Type   Company Name                                   CIK         Date Filed  File Name
---------------------------------------------------------------------------------------------
13F-HR      BlackRock, Inc.                                1364742     2026-08-07  edgar/data/1364742/0001364742-26-000123.txt
13F-HR/A    Nykredit A/S                                   318083      2026-09-08  edgar/data/318083/0000318083-26-000045.txt
13F-NT      Some Notice Filer LLC                          999999      2026-09-08  edgar/data/999999/0000999999-26-000001.txt
4           An Insider                                     123456      2026-09-08  edgar/data/123456/0000123456-26-000002.txt
13F-HR      Dodge & Cox                                    200217      2026-09-04  edgar/data/200217/0000200217-26-000007.txt
`;

test('the index parser takes 13F holdings reports and their amendments, nothing else', () => {
  const rows = parseFilingIndex(INDEX);
  assert.equal(rows.length, 3, '13F-NT and Form 4 are not holdings reports');
  assert.deepEqual(rows.map((r) => r.form).sort(), ['13F-HR', '13F-HR', '13F-HR/A']);
  const amended = rows.find((r) => r.amended);
  assert.equal(amended.form, '13F-HR/A');
  assert.equal(amended.acc, '0000318083-26-000045');
});

test('company names with spaces and ampersands survive the split', () => {
  const dodge = parseFilingIndex(INDEX).find((r) => r.cik === '0000200217');
  assert.equal(dodge.name, 'Dodge & Cox');
  assert.equal(dodge.filed, '2026-09-04');
});

test('CIKs are padded so they join with the rest of the site', () => {
  assert.ok(parseFilingIndex(INDEX).every((r) => r.cik.length === 10));
});

// The daily index is what the feed actually reads, and it writes the filing
// date without dashes. The hand-written sample above used the quarterly
// index's dashed form, so the parser passed its test and still returned an
// empty list for every real day it was given.
const DAILY_INDEX = `Description:           Daily Index of EDGAR Dissemination Feed by Form Type
Last Data Received:    September 8, 2026

Form Type   Company Name                                   CIK         Date Filed  File Name
---------------------------------------------------------------------------------------------
13F-HR      BlackRock, Inc.                                1364742     20260908    edgar/data/1364742/0001364742-26-000123.txt
13F-HR/A    Nykredit A/S                                   318083      20260908    edgar/data/318083/0000318083-26-000045.txt
13F-NT      Some Notice Filer LLC                          999999      20260908    edgar/data/999999/0000999999-26-000001.txt
`;

test('the daily index is read too, not just the quarterly one', () => {
  const rows = parseFilingIndex(DAILY_INDEX);
  assert.equal(rows.length, 2, 'an undashed filing date must not drop the row');
  assert.deepEqual(rows.map((r) => r.filed), ['2026-09-08', '2026-09-08'], 'dates normalise to ISO');
  assert.equal(rows[0].cik, '0001364742');
  assert.equal(rows[1].acc, '0000318083-26-000045');
  assert.equal(rows[1].amended, true);
});

test('both index formats produce the same row for the same filing', () => {
  const dashed = parseFilingIndex('13F-HR      Dodge & Cox       200217   2026-09-04  edgar/data/200217/0000200217-26-000007.txt');
  const plain = parseFilingIndex('13F-HR      Dodge & Cox       200217   20260904    edgar/data/200217/0000200217-26-000007.txt');
  assert.deepEqual(dashed, plain);
  assert.equal(dashed[0].filed, '2026-09-04');
});

test('junk in, empty out', () => {
  assert.deepEqual(parseFilingIndex(''), []);
  assert.deepEqual(parseFilingIndex(null), []);
  assert.deepEqual(parseFilingIndex('13F-HR   No Accession Here   123   2026-01-01   edgar/data/x.txt'), []);
});

test('merging is newest first, one row per accession, re-reads are free', () => {
  const day1 = parseFilingIndex(INDEX);
  const again = parseFilingIndex(INDEX);
  const merged = mergeFilings(day1, again, { today: '2026-09-08' });
  assert.equal(merged.length, 3, 'reading the same day twice does not duplicate');
  assert.deepEqual(
    merged.map((r) => r.filed),
    ['2026-09-08', '2026-09-04', '2026-08-07'],
    'newest filing first'
  );
});

test('a later read corrects a stored row instead of adding one', () => {
  const stored = [{ acc: '0000318083-26-000045', cik: '0000318083', name: 'NYKREDIT', filed: '2026-09-08' }];
  const fresh = [{ acc: '0000318083-26-000045', cik: '0000318083', name: 'Nykredit A/S', filed: '2026-09-08' }];
  const merged = mergeFilings(stored, fresh, { today: '2026-09-08' });
  assert.equal(merged.length, 1);
  assert.equal(merged[0].name, 'Nykredit A/S');
});

test('the window drops filings older than it and caps the row count', () => {
  const old = { acc: '0000000001-20-000001', cik: '0000000001', name: 'Ancient', filed: '2025-01-01' };
  const merged = mergeFilings([old], parseFilingIndex(INDEX), { today: '2026-09-08', windowDays: 20 });
  assert.ok(!merged.some((r) => r.acc === old.acc), 'outside the window');
  assert.ok(!merged.some((r) => r.filed === '2026-08-07'), 'a month back is outside a twenty-day window');
  assert.ok(merged.some((r) => r.filed === '2026-09-04'), 'and four days back is inside it');

  const many = Array.from({ length: 10 }, (_, i) => ({
    acc: `000000000${i}-26-00000${i}`,
    cik: '0000000001',
    name: `F${i}`,
    filed: '2026-09-08',
  }));
  assert.equal(mergeFilings([], many, { today: '2026-09-08', maxRows: 4 }).length, 4);
});

test('measured numbers attach to the filing they were measured from', () => {
  const rows = parseFilingIndex(INDEX);
  const universe = [
    { cik: '0001364742', acc: '0001364742-26-000123', aum: 6_729_538_649_155, positions: 5696, reportDate: '2026-06-30' },
    // the same filer's *earlier* filing — must not leak onto the amendment
    { cik: '0000318083', acc: '0000318083-26-000001', aum: 26_240_000_000, positions: 1945 },
  ];
  const joined = joinUniverse(rows, universe);
  const blackrock = joined.find((r) => r.cik === '0001364742');
  assert.equal(blackrock.positions, 5696);
  assert.equal(blackrock.reportDate, '2026-06-30');

  const amendment = joined.find((r) => r.amended);
  assert.equal(amendment.aum, null, 'an amendment does not inherit the original filing figures');
  assert.equal(amendment.positions, null);
});

test('report periods group by quarter, and an unknown period is not guessed', () => {
  assert.equal(quarterKey('2026-06-30'), 'Q2 2026');
  assert.equal(quarterKey('2026-01-31'), 'Q1 2026');
  assert.equal(quarterKey('2025-12-31'), 'Q4 2025');
  assert.equal(quarterKey(null), null);
  assert.equal(quarterKey('not-a-date'), null);

  const quarters = quartersOf([
    { reportDate: '2026-06-30' },
    { reportDate: '2026-06-30' },
    { reportDate: '2026-03-31' },
    { reportDate: null },
  ]);
  assert.deepEqual(quarters, [
    { quarter: 'Q2 2026', count: 2 },
    { quarter: 'Q1 2026', count: 1 },
  ]);
});
