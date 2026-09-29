// Regression cases on real Form 4 submissions from EDGAR (tests/fixtures/
// form4/*.txt — the SEC header and the Form 4 XML as filed; exhibits such
// as powers of attorney left out). Each file goes through the parser, then
// what the site does with the line: the market check for foreign issuers
// (fpiNormalize.js), the compensation-share state (insiderNotes.js), the
// category (insiderClassify.js) and the cluster label (insiderCluster.js).
// Issuer records, the US close of the trade day and the exchange rates are
// frozen in tests/fixtures/form4/regression-context.json.
//
//   BABA  0001193125-26-291402  "Ordinary Shares" sold at the ADS price in
//                               US dollars; 692,992 = 86,624 ADSs × 8
//   SMFG  0000950103-26-011227  a price "converted into U.S. dollars" from
//                               yen, code D: never read as yen again
//   ASX   0000950103-26-010631  option exercise at "New Taiwan dollars"
//                               NT$41.10: not taken as US$41.10
//   MTDR  0001934692-26-000004  "Includes shares acquired pursuant to the
//                               ESPP. Such acquisitions are exempt under Rule
//                               16b-3" — about the holding: an open buy
//   EML   0000031107-26-000039  "shares issued under The Eastern Company
//                               Director's Fee Program": code P, but pay
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseForm4Submission } from '../api/_lib/insiderForm4.js';
import { normalizeRow } from '../api/_lib/fpiNormalize.js';
import { markCompensation } from '../api/_lib/insiderNotes.js';
import { categorize } from '../api/_lib/insiderClassify.js';
import { lineLabels, exclusionOf } from '../api/_lib/insiderCluster.js';

const CTX = JSON.parse(fs.readFileSync(new URL('./fixtures/form4/regression-context.json', import.meta.url)));
const filing = async (name) => {
  const body = fs.readFileSync(new URL(`./fixtures/form4/${name}.txt`, import.meta.url), 'utf8');
  const parsed = await parseForm4Submission(body, { filed: '2026-09-01' });
  const rawOf = (r) => parsed.raw[`${r.a}:${r.li}`] || null;
  return { rows: parsed.rows, rawOf };
};
// what the served row becomes for a foreign issuer's line
const served = (r, rawOf) => {
  const close = CTX.closes[r.t];
  return normalizeRow(r, { raw: rawOf(r), issuer: CTX.issuers[r.ci] || null, rates: CTX.rates, series: close ? [close] : null, splits: {} });
};

test('BABA: "Ordinary Shares" at the ADS price, a whole number of ADSs → 86,624 ADSs, $8.2M (not $65.8M)', async () => {
  const { rows, rawOf } = await filing('baba-0001193125-26-291402');
  assert.equal(rows.length, 2);
  const [a, b] = rows.map((r) => served(r, rawOf));
  assert.deepEqual([a.cu, a.ar, a.pa, a.s, a.p], ['USD', 8, 1, 86624, 94.92]);
  assert.equal(a.v, Math.round(86624 * 94.92));
  assert.deepEqual([b.ar, b.s], [8, 3376]);
});

test('SMFG: a price converted into dollars from yen is never read as yen; a disposition under a pay plan is not a market price', async () => {
  const { rows, rawOf } = await filing('smfg-0000950103-26-011227');
  const d = rows.find((r) => r.k === 'D');
  assert.equal(d.p, 43.99);
  const n = served(d, rawOf);
  assert.equal(n.fail, 'non_market');
  assert.notEqual(n.cu, 'JPY', 'the old reading: 43.99 yen × 100 = $26.87, $1,908 for $312K');
  // the two awards (code A, no price) are left alone
  assert.deepEqual(rows.filter((r) => r.k === 'A').map((r) => categorize(r)), ['award', 'award']);
});

test('ASE: an option exercise "at New Taiwan dollars" is not a US-dollar amount (was $61.7M + $123M)', async () => {
  const { rows, rawOf } = await filing('asx-0000950103-26-010631');
  assert.deepEqual(rows.map((r) => [r.k, r.p]), [['M', 41.1], ['M', 98.6]]);
  const [first, second] = rows.map((r) => served(r, rawOf));
  // no dollar amount for either (a strike price cannot be checked against
  // the market)
  assert.deepEqual([first.fail, second.fail], ['non_market', 'non_market']);
  assert.equal(first.cu, 'TWD');
  // the second line's F4 writes its strike as "$99.7 to $98.6" (NT$ meant):
  // labelled USD, still no amount
  assert.equal(second.lv, Math.round(1500000 * 98.6));
});

test('MTDR: a note about the holding ("Includes … Such acquisitions are exempt under Rule 16b-3") does not make the buy pay or a plan purchase', async () => {
  const { rows, rawOf } = await filing('mtdr-0001934692-26-000004');
  const [r] = markCompensation(rows, rawOf);
  assert.equal(r.cp, undefined);
  assert.equal(categorize(r), 'open_buy');
  assert.equal(lineLabels([r], rawOf).has(r), false);
  assert.equal(exclusionOf(r), null, 'it counts toward a cluster');
});

test('EML: code P, but "shares issued under The Eastern Company Director\'s Fee Program" — pay, not an open-market buy', async () => {
  const { rows, rawOf } = await filing('eml-0000031107-26-000039');
  const [r] = markCompensation(rows, rawOf);
  assert.equal(r.k, 'P');
  assert.match(r.cp, /Director's Fee Program pursuant to rule 16b-3\(d\)/);
  assert.equal(categorize(r), 'compensation');
  assert.equal(exclusionOf(r), 'not_open_buy');
  assert.equal(lineLabels([r], rawOf).get(r).label, 'compensation');
});
