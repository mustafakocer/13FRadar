// A 13F filer's own Form 4 lines (api/_lib/guruForm4.js, /api/guru-form4):
// joined by the reporting-owner CIK when the crawl stored one, by the
// registered name otherwise, never by a subsidiary's name.
import test from 'node:test';
import assert from 'node:assert/strict';
import './helpers.mjs';
import { guruForm4Rows, byTicker, foldDays, normName, filerName } from '../api/_lib/guruForm4.js';
import { invoke } from '../api/_lib/ssr/invoke.js';

const row = (o) => ({ t: 'DVA', ci: '0000927066', n: 'BERKSHIRE HATHAWAY INC', r: 'owner10', d: '2026-07-31', f: '2026-08-04', k: 'S', s: 170000, p: 141.1, v: 23987000, o: 28700000, oc: -0.6, a: '0001193125-26-300001', li: 0, ...o });
const universe = { rows: [{ cik: '0001067983', name: 'BERKSHIRE HATHAWAY INC' }, { cik: '0000921669', name: 'ICAHN CARL C' }] };

test('names compare without punctuation or the legal form', () => {
  assert.equal(normName('Berkshire Hathaway, Inc.'), 'BERKSHIRE HATHAWAY');
  assert.equal(normName('BERKSHIRE HATHAWAY INC'), 'BERKSHIRE HATHAWAY');
  assert.equal(normName('Icahn Enterprises Holdings L.P.'), 'ICAHN ENTERPRISES HOLDINGS', 'HOLDINGS tells sister entities apart and stays');
  assert.equal(filerName('1067983', universe), 'BERKSHIRE HATHAWAY INC');
});

test('owner CIK joins when present; the registered name joins the older lines; a subsidiary does not', () => {
  const rows = [
    row({ a: 'A1', ow: '0001067983', d: '2026-09-17', t: 'LEN' }), // new line, keyed by CIK
    row({ a: 'A2' }), // older line, no ow: name match
    row({ a: 'A3', n: 'NATIONAL INDEMNITY CO', ow: null }), // subsidiary: not joined
    row({ a: 'A4', ow: '0000921669', n: 'ICAHN CARL C', t: 'IEP', d: '2026-09-23' }), // someone else's CIK
    row({ a: 'A5', n: 'Berkshire Hathaway, Inc.', ow: undefined, d: '2026-06-01' }), // punctuation differs
  ];
  const got = guruForm4Rows('1067983', { rows, name: 'BERKSHIRE HATHAWAY INC' });
  assert.deepEqual(got.map((r) => r.a), ['A1', 'A2', 'A5'], 'newest trade first');
  // a line with ow that names the fund but carries another CIK is not joined
  const other = guruForm4Rows('1067983', { rows: [row({ a: 'B1', ow: '0000000009' })], name: 'BERKSHIRE HATHAWAY INC' });
  assert.equal(other.length, 0);
  // no registered name on file: only the CIK key works
  assert.deepEqual(guruForm4Rows('1067983', { rows, name: null }).map((r) => r.a), ['A1']);
});

test('byTicker keeps the latest line and the count per symbol, skipping unresolved tickers', () => {
  const rows = [row({ a: 'A1', d: '2026-07-31' }), row({ a: 'A2', d: '2026-08-05', k: 'S', s: 100 }), row({ a: 'A3', t: null })];
  const m = byTicker(rows);
  assert.deepEqual(Object.keys(m), ['DVA']);
  assert.equal(m.DVA.count, 2);
  assert.equal(m.DVA.last.d, '2026-08-05');
  assert.equal(m.DVA.last.s, 100);
});

test('a day\'s lots fold into one row: shares and value summed, price share-weighted, stake change only for a single line', () => {
  const rows = [
    row({ a: 'A1', li: 1, d: '2026-10-02', k: 'P', s: 100, p: 80, v: 8000, o: 1100, oc: 10 }),
    row({ a: 'A1', li: 0, d: '2026-10-02', k: 'P', s: 300, p: 78, v: 23400, o: 1000, oc: 42.9 }),
    row({ a: 'A0', li: 0, d: '2026-10-01', k: 'P', s: 50, p: 81, v: 4050, o: 700, oc: 7.7 }),
    row({ a: 'A2', li: 0, d: '2026-10-02', k: 'S', s: 10, p: 82, v: 820, o: 1090, oc: -0.9 }),
  ];
  const f = foldDays(rows);
  assert.deepEqual(f.map((r) => [r.d, r.k, r.lines]), [['2026-10-02', 'P', 2], ['2026-10-02', 'S', 1], ['2026-10-01', 'P', 1]], 'newest day first');
  const buy = f[0];
  assert.equal(buy.s, 400);
  assert.equal(buy.v, 31400);
  assert.equal(buy.p, 78.5); // (100×80 + 300×78) / 400
  assert.equal(buy.o, 1100);
  assert.equal(buy.oc, null, 'two lots, two bases: no change figure');
  assert.equal(f[2].oc, 7.7, 'a single line keeps its own');
});

test('/api/guru-form4/:cik answers from the served dataset, empty for a filer with no lines', async () => {
  const { default: handler } = await import('../api/_handlers/guru-form4.js');
  const bad = await invoke(handler, { cik: 'abc' });
  assert.equal(bad.status, 400);
  const none = await invoke(handler, { cik: '0000000001' });
  assert.equal(none.status, 200);
  assert.equal(none.body.count, 0);
  assert.deepEqual(none.body.rows, []);
  assert.deepEqual(none.body.byTicker, {});
  assert.match(none.headers['cache-control'] || none.headers['Cache-Control'] || '', /s-maxage=1800/);
});
