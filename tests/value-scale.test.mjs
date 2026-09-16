import test from 'node:test';
import assert from 'node:assert/strict';
import { detectValueScale, valueMultiplier, aggregatePositions } from '../api/_lib/sec.js';

// Filers that ignore the reporting-unit rule report a $7B book as $7M or the
// other way round. The date rule decides the multiplier; this is the check
// that the result implies share prices a stock could actually trade at.

// A filing of `n` positions whose implied price is `price` under the stated
// units, i.e. what the filer literally wrote in <value>.
const filing = (n, price, mult, type = 'SH') =>
  Array.from({ length: n }, (_, i) => ({
    cusip: `CUSIP${i}`,
    nameOfIssuer: `ISSUER ${i}`,
    value: (price * 1000) / mult,
    shrsOrPrnAmt: { sshPrnamt: 1000, sshPrnamtType: type },
  }));

test('the reporting-unit rule changed on 2023-01-03', () => {
  assert.equal(valueMultiplier('2022-12-31'), 1000);
  assert.equal(valueMultiplier('2023-01-03'), 1);
  assert.equal(valueMultiplier(null), 1000, 'unknown dates take the older, safer rule');
});

test('a filing whose stated units already imply sane prices is left alone', () => {
  const r = detectValueScale(filing(10, 150, 1), '2026-08-14');
  assert.equal(r.corrected, false);
  assert.equal(r.mult, 1);
  assert.ok(r.median > 100 && r.median < 200);
});

test('whole dollars written into a thousands filing are scaled back down', () => {
  // filed before the rule change, so <value> should be thousands: 150 for a
  // $150,000 position. This filer wrote 150,000, so the stated units imply
  // $150,000 a share.
  const rows = filing(20, 150, 1);
  const r = detectValueScale(rows, '2021-05-15');
  assert.equal(r.corrected, true);
  assert.equal(r.mult, 1); // 1000 stated, ÷1000
  assert.ok(r.median > 100_000, 'the stated units imply a price no stock trades at');
  assert.ok(r.correctedMedian > 100 && r.correctedMedian < 200);
});

test('a book that implies fractions of a cent a share is scaled back up', () => {
  const rows = filing(20, 0.15, 1).map((r) => ({ ...r, value: r.value / 1000 }));
  const r = detectValueScale(rows, '2026-08-14');
  assert.equal(r.corrected, true);
  assert.equal(r.mult, 1000);
});

test('a penny-stock book is left exactly as filed', () => {
  // fifteen cents a share is what a thousands-in-a-dollars-filing error looks
  // like, and also what a real penny fund looks like. Without market prices
  // there is no telling them apart, so the filing stands.
  const r = detectValueScale(filing(20, 0.15, 1), '2026-08-14');
  assert.equal(r.corrected, false);
  assert.equal(r.mult, 1);
});

test('a small filing is never corrected on a handful of rows', () => {
  const rows = filing(3, 150, 1);
  assert.equal(detectValueScale(rows, '2021-05-15').corrected, false);
  assert.equal(detectValueScale(rows, '2021-05-15').median, null);
});

test('one Berkshire A position does not drag a normal book out of band', () => {
  const rows = [...filing(12, 150, 1), ...filing(1, 700_000, 1)];
  const r = detectValueScale(rows, '2026-08-14');
  assert.equal(r.corrected, false, 'the median is what is judged, not the extremes');
});

test('principal amounts do not vote — they are not share counts', () => {
  const debt = filing(20, 150, 1, 'PRN');
  assert.equal(detectValueScale(debt, '2026-08-14').median, null, 'no share rows to judge by');
});

test('a filing that neither unit makes sane is reported rather than mangled', () => {
  // 0.0000001 a share; ×1000 is still a hundred-thousandth of a cent
  const rows = filing(20, 0.0000001, 1);
  const r = detectValueScale(rows, '2026-08-14');
  assert.equal(r.corrected, false);
  assert.equal(r.mult, 1);
});

test('the correction reaches the aggregate, and says that it did', () => {
  const rows = filing(20, 150, 1);
  const { aum, positions, unitFix } = aggregatePositions(rows, '2021-05-15');
  assert.equal(unitFix, true);
  // 20 positions × 1000 shares × $150
  assert.equal(Math.round(aum), 20 * 1000 * 150);
  assert.ok(positions.every((p) => Math.abs(p.weight - 5) < 0.001));

  const clean = aggregatePositions(filing(20, 150, 1), '2026-08-14');
  assert.equal(clean.unitFix, undefined, 'an untouched filing carries no flag');
});
