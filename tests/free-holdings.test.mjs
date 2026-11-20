// The free tier of GET /api/holdings: ?cusips= names rows, it never widens
// what a non-Pro reader may see (api/_lib/freeHoldings.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { FREE_ROWS, parseCusipFilter, topCusips, freeRows, followingFiling } from '../api/_lib/freeHoldings.js';

// a book, largest first: CUSIPs 000000001 … 0000000NN
const cusip = (n) => String(n).padStart(9, '0');
const book = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => ({ cusip: cusip(from + i), value: 1000 - i }));
const ids = (rows) => rows.map((p) => Number(p.cusip));

test('parseCusipFilter: well-formed, upper-cased, deduplicated, at most FREE_ROWS', () => {
  assert.deepEqual(parseCusipFilter(' 02079k305 ,bad,02079K305,,<script>,0378331005'), ['02079K305']);
  assert.equal(parseCusipFilter(book(1, 25).map((p) => p.cusip).join(',')).length, FREE_ROWS);
  assert.deepEqual(parseCusipFilter(undefined), []);
  assert.deepEqual(parseCusipFilter(['000000001', '000000002']), ['000000001', '000000002']);
});

test('no filter: the ten largest rows', () => {
  assert.deepEqual(ids(freeRows(book(1, 30))), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(freeRows([], []), []);
  assert.deepEqual(freeRows(null, ['000000001']), []);
});

test('rows below the top ten cannot be asked for by CUSIP', () => {
  const positions = book(1, 30);
  // the audit's request: ten CUSIPs outside the free view
  const filter = parseCusipFilter(book(11, 20).map((p) => p.cusip).join(','));
  assert.deepEqual(freeRows(positions, filter), []);
  // a mixed list answers only its free part
  assert.deepEqual(ids(freeRows(positions, [cusip(2), cusip(15), cusip(30), cusip(9)])), [2, 9]);
  // every possible request together never leaves the top ten
  const seen = new Set();
  for (let i = 1; i <= 30; i += 10) {
    for (const p of freeRows(positions, parseCusipFilter(book(i, i + 9).map((x) => x.cusip).join(',')))) seen.add(Number(p.cusip));
  }
  assert.deepEqual([...seen].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test('the previous quarter answers the rows the following filing shows for free', () => {
  // previous quarter: 30 lines; the following filing's free view holds names
  // that sat at 12, 17 and 25 the quarter before, and one new name
  const prev = book(1, 30);
  const nextTop = topCusips([{ cusip: cusip(12) }, { cusip: cusip(1) }, { cusip: cusip(17) }, { cusip: cusip(25) }, { cusip: cusip(99) }]);
  const filter = [cusip(12), cusip(1), cusip(17), cusip(25), cusip(99)];
  assert.deepEqual(ids(freeRows(prev, filter, nextTop)), [1, 12, 17, 25]);
  // still nothing outside the two free views
  assert.deepEqual(ids(freeRows(prev, [cusip(12), cusip(13), cusip(26)], nextTop)), [12]);
  // the following filing unreadable: fail closed to this filing's own top ten
  assert.deepEqual(ids(freeRows(prev, filter, null)), [1]);
});

test('an option line shares its CUSIP with the share line: both rows of an allowed CUSIP come back', () => {
  const positions = [{ cusip: cusip(1), value: 900 }, { cusip: cusip(1), value: 500, putCall: 'Put' }, ...book(2, 20)];
  assert.equal(freeRows(positions, [cusip(1)]).length, 2);
});

test('topCusips reads only the free rows and ignores case', () => {
  assert.equal(topCusips(book(1, 30)).size, FREE_ROWS);
  assert.ok(topCusips([{ cusip: '02079k305' }]).has('02079K305'));
  assert.equal(topCusips(null).size, 0);
});

test('followingFiling: the period filed after, in a newest-first list', () => {
  const filings = [{ acc: 'c' }, { acc: 'b' }, { acc: 'a' }];
  assert.deepEqual(followingFiling(filings, { acc: 'a' }), { acc: 'b' });
  assert.deepEqual(followingFiling(filings, { acc: 'b' }), { acc: 'c' });
  assert.equal(followingFiling(filings, { acc: 'c' }), null); // the newest has none
  assert.equal(followingFiling(filings, { acc: 'zz' }), null);
  assert.equal(followingFiling(filings, null), null);
  assert.equal(followingFiling([], { acc: 'a' }), null);
});
