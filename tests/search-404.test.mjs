import test from 'node:test';
import assert from 'node:assert/strict';
import { ssr } from './helpers.mjs';
import { matchStocks, TICKERISH } from '../client/src/lib/stockMatch.js';
import { guruMatches, withGurusFirst } from '../api/_handlers/search.js';

const ROWS = [
  { ticker: 'AAPL', issuer: 'APPLE INC', funds: 6201 },
  { ticker: 'AAP', issuer: 'ADVANCE AUTO PARTS INC', funds: 400 },
  { ticker: 'AAON', issuer: 'AAON INC', funds: 300 },
  { ticker: 'APLE', issuer: 'APPLE HOSPITALITY REIT INC', funds: 250 },
  { ticker: 'BRK.B', issuer: 'BERKSHIRE HATHAWAY INC DEL', funds: 3000 },
  { issuer: 'NO TICKER CO', funds: 9 },
];

test('matchStocks: an exact ticker comes first, then prefixes by how widely held', () => {
  const r = matchStocks(ROWS, 'aap');
  assert.deepEqual(r.map((s) => s.ticker), ['AAP', 'AAPL']);
  assert.equal(matchStocks(ROWS, 'AAPL')[0].ticker, 'AAPL');
});

test('matchStocks: issuer names match from three letters on, rows without a ticker never', () => {
  assert.deepEqual(matchStocks(ROWS, 'apple').map((s) => s.ticker), ['AAPL', 'APLE']);
  // two letters: ticker prefixes only, so "AAPL" (name APPLE) is not offered
  assert.deepEqual(matchStocks(ROWS, 'ap').map((s) => s.ticker), ['APLE']);
  assert.deepEqual(matchStocks(ROWS, 'no ticker'), []);
  assert.deepEqual(matchStocks(null, 'AAPL'), []);
  assert.deepEqual(matchStocks(ROWS, '   '), []);
});

test('TICKERISH: symbols with a class suffix pass, sentences do not', () => {
  assert.ok(TICKERISH.test('BRK.B'));
  assert.ok(TICKERISH.test('nvda'));
  assert.ok(!TICKERISH.test('warren buffett'));
  assert.ok(!TICKERISH.test('13F'));
  assert.ok(!TICKERISH.test('Buffett'), 'seven letters is a name, not a symbol');
  assert.ok(TICKERISH.test('GOOGL'));
  assert.ok(TICKERISH.test('BF-B'));
});

test('search: "Buffett" puts the tracked Berkshire book above EDGAR personal filers', () => {
  const g = guruMatches('Buffett');
  assert.equal(g[0].cik, '0001067983');
  assert.equal(g[0].guru, true);
  const edgar = [
    { name: 'BUFFETT WARREN E', cik: '0000315090', filings: 19 },
    { name: 'BERKSHIRE HATHAWAY INC', cik: '0001067983', filings: 120 },
  ];
  const out = withGurusFirst('Buffett', edgar);
  assert.equal(out[0].cik, '0001067983');
  assert.equal(out.filter((r) => r.cik === '0001067983').length, 1, 'the guru is not listed twice');
  assert.equal(out[1].cik, '0000315090');
});

test('search: every word of the query must appear; no match leaves EDGAR as it was', () => {
  assert.equal(guruMatches('warren buffett')[0].cik, '0001067983');
  assert.deepEqual(guruMatches('buffett ackman'), []);
  const edgar = [{ name: 'SOME FUND LP', cik: '0000000001', filings: 3 }];
  assert.deepEqual(withGurusFirst('zzzz-no-such-guru', edgar), edgar);
});

test('an unknown path answers 404 with the not-found page, not an empty main', async () => {
  const { status, html } = await ssr('/en/this-page-does-not-exist');
  assert.equal(status, 404);
  assert.match(html, /data-not-found/);
  assert.match(html, /Page not found/);
  const tr = await ssr('/tr/account/olmayan-sayfa');
  assert.equal(tr.status, 404);
  assert.match(tr.html, /Sayfa bulunamadı/);
});
