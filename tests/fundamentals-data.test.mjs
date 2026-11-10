import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { root } from './helpers.mjs';
import { valuationFor } from '../api/_lib/secFundamentals.js';
import { usdPerUnit } from '../api/_lib/fx.js';

// B — the committed fundamentals against numbers worked out by hand from the
// filings themselves, within 2%.

const file = JSON.parse(fs.readFileSync(path.join(root, 'api/_data/fundamentals.json'), 'utf8'));
const rec = (t) => file.byTicker[t];
const near = (a, b, what) => assert.ok(Math.abs(a / b - 1) <= 0.02, `${what}: ${a} vs ${b} by hand`);

// FY2026 10-K (filed 2026-11-03): 8.98 diluted for the year to 2026-09-26.
// Q1–Q3 were 2.84 + 2.01 + 2.02 (the 10-Qs), so Q4 = 2.11; the trailing year
// is the fiscal year until the FY2027 Q1 10-Q (late January 2027) adds a
// quarter and drops 2.84. Cover: 14,532,182,000 shares at 2026-10-23.
// A new 10-Q moves this window; re-derive it then, from the filings.
test('AAPL: TTM to 2026-09-26 = the FY2026 10-K year, 8.98 (2.84 + 2.01 + 2.02 + Q4 2.11); cap = 14,532,182,000 shares × price', () => {
  const q4 = 8.98 - 2.84 - 2.01 - 2.02;
  const eps = 2.84 + 2.01 + 2.02 + q4;
  near(rec('AAPL').eps.value, eps, 'EPS');
  assert.equal(rec('AAPL').eps.end, '2026-09-26');
  const v = valuationFor(rec('AAPL'), 330.32);
  near(v.pe, 330.32 / eps, 'P/E');
  near(v.marketCap, 14_532_182_000 * 330.32, 'market cap');
  assert.equal(rec('AAPL').eps.form, '10-K');
  assert.match(rec('AAPL').eps.url, /^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\/320193\//);
});

// FY2026 10-K: 17.95 for the year, Q1–Q3 3.72 + 5.16 + 4.27, so Q4 = 4.80;
// the FY2027 Q1 10-Q (filed 2026-10-28) adds 4.92 and drops Q1 FY2026.
// A new 10-Q moves this window; re-derive it then, from the filings.
test('MSFT: TTM to 2026-09-30 = 5.16 + 4.27 + Q4 FY26 (17.95 − 3.72 − 5.16 − 4.27) + 4.92', () => {
  const q4 = 17.95 - 3.72 - 5.16 - 4.27;
  near(rec('MSFT').eps.value, 5.16 + 4.27 + q4 + 4.92, 'EPS');
  assert.equal(rec('MSFT').eps.end, '2026-09-30');
  near(valuationFor(rec('MSFT'), 512.8).marketCap, 7_425_545_491 * 512.8, 'market cap');
});

// 10-K 2025 (66,968 for the year, 47,769 for its first nine months, so Q4 =
// 19,199) and the 2026 10-Qs: 10,106 + 25,667 + 22,112 (Q3, filed 2026-11-09).
// Net earnings attributable to Berkshire shareholders, $ millions.
// A new 10-Q moves this window; re-derive it then, from the filings.
test('BRK-B: net income TTM to 2026-09-30 ((66.968 − 47.769) + 10.106 + 25.667 + 22.112 B) over the Class-B-equivalent shares', () => {
  const ni = (66_968 - 47_769 + 10_106 + 25_667 + 22_112) * 1e6;
  assert.equal(rec('BRK-B').eps.end, '2026-09-30');
  const shares = rec('BRK-B').shares.value; // Class A × 1,500 + Class B, the 10-Q cover
  near(rec('BRK-B').eps.value, ni / shares, 'EPS per B share');
  const v = valuationFor(rec('BRK-B'), 500.5);
  near(v.pe, 500.5 / (ni / shares), 'P/E');
  assert.ok(v.marketCap > 9e11 && v.marketCap < 1.3e12, `market cap ${v.marketCap}`);
  // the A share is the same company: 1,500× the B figures
  near(rec('BRK-A').eps.value, rec('BRK-B').eps.value * 1500, 'EPS per A share');
});

// The home-currency figure is converted at the rate of the day the file was
// built (scripts/build-fundamentals.mjs: today's rate, else the newest within
// three weeks), so the hand figure uses that day too. A fixed day here drifted
// with the currency: TWD lost 3% between 2026-10-02 and 2026-11-09 and the
// test failed on a number that was right.
test('TSM (20-F, IFRS): TWD 65.47 diluted EPS × the TWD rate of the build day × 5 shares per ADS; cap = 25,932,524,521 / 5 × price', () => {
  const fpi = JSON.parse(fs.readFileSync(path.join(root, 'api/_data/fpi.json'), 'utf8'));
  const rate = usdPerUnit('TWD', file.updatedAt.slice(0, 10), fpi.rates, { maxStaleDays: 21 });
  assert.ok(rate > 0.02 && rate < 0.05, `TWD rate on the build day: ${rate}`);
  const t = rec('TSM');
  assert.equal(t.eps.currency, 'TWD');
  assert.equal(t.eps.local, 65.47);
  assert.equal(t.eps.perAds, 5);
  assert.equal(t.eps.form, '20-F');
  near(t.eps.value, 65.47 * rate * 5, 'EPS per ADS');
  near(valuationFor(t, 459.2).marketCap, (25_932_524_521 / 5) * 459.2, 'market cap');
});

test('a loss: INTC and RIVN read "loss", never a negative P/E', () => {
  for (const t of ['INTC', 'RIVN']) {
    assert.ok(rec(t).eps.value < 0, t);
    assert.equal(valuationFor(rec(t), 20).pe, 'loss', t);
  }
});

test('SLBT: SEC has no periodic report for it (an F-1 registration only) — no figure is invented', () => {
  assert.equal(rec('SLBT'), undefined);
  assert.deepEqual(valuationFor(undefined, 5), { pe: null, marketCap: null, dividendYield: null });
});
