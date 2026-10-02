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

test('AAPL: EPS = FY2025 Q4 (7.46 − 2.40 − 1.65 − 1.57) + 2.84 + 2.01 + 2.02; cap = 14,594,180,000 shares × price', () => {
  const eps = 7.46 - 2.4 - 1.65 - 1.57 + 2.84 + 2.01 + 2.02;
  near(rec('AAPL').eps.value, eps, 'EPS');
  const v = valuationFor(rec('AAPL'), 330.32);
  near(v.pe, 330.32 / eps, 'P/E');
  near(v.marketCap, 14_594_180_000 * 330.32, 'market cap');
  assert.equal(rec('AAPL').eps.form, '10-Q');
  assert.match(rec('AAPL').eps.url, /^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\/320193\//);
});

test('MSFT: fiscal 2026 = 3.72 + 5.16 + 4.27 + Q4 (17.95 − the three)', () => {
  near(rec('MSFT').eps.value, 17.95, 'EPS');
  near(valuationFor(rec('MSFT'), 512.8).marketCap, 7_425_545_491 * 512.8, 'market cap');
});

test('BRK-B: net income TTM (30.796 + (66.968 − 4.603 − 12.370 − 30.796) + 10.106 + 25.667 B) over the Class-B-equivalent shares', () => {
  // 10-K 2025 and 10-Qs 2025–2026, net earnings attributable to Berkshire shareholders ($ millions)
  const ni = (30_796 + (66_968 - 4_603 - 12_370 - 30_796) + 10_106 + 25_667) * 1e6;
  const shares = rec('BRK-B').shares.value; // Class A × 1,500 + Class B, the 10-Q cover
  near(rec('BRK-B').eps.value, ni / shares, 'EPS per B share');
  const v = valuationFor(rec('BRK-B'), 500.5);
  near(v.pe, 500.5 / (ni / shares), 'P/E');
  assert.ok(v.marketCap > 9e11 && v.marketCap < 1.3e12, `market cap ${v.marketCap}`);
  // the A share is the same company: 1,500× the B figures
  near(rec('BRK-A').eps.value, rec('BRK-B').eps.value * 1500, 'EPS per A share');
});

test('TSM (20-F, IFRS): TWD 65.47 diluted EPS × the TWD rate × 5 shares per ADS; cap = 25,932,524,521 / 5 × price', () => {
  const fpi = JSON.parse(fs.readFileSync(path.join(root, 'api/_data/fpi.json'), 'utf8'));
  const rate = usdPerUnit('TWD', '2026-10-02', fpi.rates);
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
