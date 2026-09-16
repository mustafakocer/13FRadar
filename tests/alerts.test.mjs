import test from 'node:test';
import assert from 'node:assert/strict';
import { matchFilings, matchInsiders, nextMark, renderDigest, digestSubject } from '../api/_lib/alerts.js';

// What an alert reports, and what it must not report twice.

const FILINGS = [
  { cik: '0001067983', name: 'Berkshire Hathaway', filed: '2026-08-14', acc: 'a1', amended: false },
  { cik: '0001067983', name: 'Berkshire Hathaway', filed: '2026-08-14', acc: 'a2', amended: true },
  { cik: '0001336528', name: 'Pershing Square', filed: '2026-08-13', acc: 'b1', amended: false },
  { cik: '0009999999', name: 'Somebody Else', filed: '2026-08-15', acc: 'c1', amended: false },
];

test('only the filers on the watchlist are reported', () => {
  const m = matchFilings(FILINGS, { ciks: ['0001067983'] });
  assert.equal(m.length, 2);
  assert.ok(m.every((f) => f.cik === '0001067983'));
});

test('an unpadded CIK still matches — they arrive both ways', () => {
  assert.equal(matchFilings(FILINGS, { ciks: ['1336528'] }).length, 1);
});

test('an empty watchlist reports nothing rather than everything', () => {
  assert.deepEqual(matchFilings(FILINGS, { ciks: [] }), []);
  assert.deepEqual(matchFilings(FILINGS, {}), []);
});

test('the same day is re-read, but an accession already sent is not re-sent', () => {
  // a filer can file after the digest ran, so the day itself stays in scope
  const m = matchFilings(FILINGS, {
    ciks: ['0001067983'],
    since: '2026-08-14',
    seenAccessions: ['a1'],
  });
  assert.deepEqual(
    m.map((f) => f.acc),
    ['a2']
  );
});

test('filings come back newest first', () => {
  const m = matchFilings(FILINGS, { ciks: ['0001067983', '0001336528', '0009999999'] });
  assert.deepEqual(m.map((f) => f.filed), ['2026-08-15', '2026-08-14', '2026-08-14', '2026-08-13']);
});

const ROWS = [
  { t: 'AAPL', n: 'Cook Tim', r: 'ceo', k: 'P', v: 2_000_000, d: '2026-09-01', f: '2026-09-02', p5: false },
  { t: 'AAPL', n: 'Someone', r: 'director', k: 'S', v: 500_000, d: '2026-09-01', f: '2026-09-02', p5: true },
  { t: 'MSFT', n: 'Nadella', r: 'ceo', k: 'P', v: 50_000, d: '2026-08-30', f: '2026-08-31', p5: false },
];

test('a saved insider filter is the filter, applied again', () => {
  assert.equal(matchInsiders(ROWS, { tickers: ['AAPL'] }).length, 2);
  assert.equal(matchInsiders(ROWS, { roles: ['ceo'] }).length, 2);
  assert.equal(matchInsiders(ROWS, { codes: ['p'] }).length, 2, 'codes are case-insensitive');
  assert.equal(matchInsiders(ROWS, { minValue: 1_000_000 }).length, 1);
  assert.equal(matchInsiders(ROWS, { excludePlanned: true }).length, 2);
  assert.equal(matchInsiders(ROWS, {}).length, 3, 'no filters means the whole feed');
});

test('an insider alert only reports what was filed after the last one', () => {
  const m = matchInsiders(ROWS, {}, { since: '2026-08-31' });
  assert.equal(m.length, 2);
  assert.ok(m.every((r) => r.f > '2026-08-31'));
});

test('the high-water mark advances to the newest match and never on an empty run', () => {
  assert.equal(nextMark(ROWS, 'f'), '2026-09-02');
  assert.equal(nextMark([], 'f', '2026-08-31'), '2026-08-31', 'nothing matched, nothing moves');
  assert.equal(nextMark(ROWS, 'f', '2026-09-10'), '2026-09-10', 'the mark never goes backwards');
});

test('the digest names what happened, in the reader’s language', () => {
  const body = renderDigest({ filings: matchFilings(FILINGS, { ciks: ['0001067983'] }), insiders: [ROWS[0]], siteUrl: 'https://fundocap.com' });
  assert.match(body, /New 13F filings/);
  assert.match(body, /Berkshire Hathaway/);
  assert.match(body, /\(amendment\)/, 'an amendment is labelled as one');
  assert.match(body, /AAPL/);
  assert.match(body, /https:\/\/fundocap\.com\/en\/watchlist/);

  const tr = renderDigest({ filings: [FILINGS[0]], insiders: [], siteUrl: 'https://fundocap.com' }, 'tr');
  assert.match(tr, /yeni 13F bildirimleri/);
  assert.match(tr, /\/tr\/watchlist/);
});

test('nothing to say means no email, not an empty one', () => {
  assert.equal(renderDigest({ filings: [], insiders: [] }), null);
  assert.equal(digestSubject({ filings: [], insiders: [] }), null);
  assert.equal(digestSubject({ filings: [1], insiders: [1, 2] }), 'Fundocap — 1 new 13F, 2 insider trades');
});
