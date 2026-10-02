import test from 'node:test';
import assert from 'node:assert/strict';
import { trailing, periods, trailingOf, EPS_CONCEPTS, sharesOutstanding, fundamentalsOf, valuationFor, weeklyBeta, filingUrl, mergeFacts } from '../api/_lib/secFundamentals.js';

// B — fundamentals from SEC XBRL (companyfacts)

const e = (start, end, val, form = '10-Q', filed = end, accn = `A-${end}`) => ({ start, end, val, form, filed, accn });
// a calendar-year filer: three 10-Qs a year, the 10-K states the year (and YTDs)
const calendar = [
  e('2025-01-01', '2025-03-31', 1.0),
  e('2025-04-01', '2025-06-30', 1.1),
  e('2025-01-01', '2025-06-30', 2.1), // 6-month YTD, ignored
  e('2025-07-01', '2025-09-30', 1.2),
  e('2025-01-01', '2025-12-31', 5.0, '10-K', '2026-02-10', 'K-2025'),
  e('2026-01-01', '2026-03-31', 1.3),
  e('2026-04-01', '2026-06-30', 1.4, '10-Q', '2026-08-01', 'Q-2026-2'),
];

test('EPS TTM: the last four quarters, Q4 = the year minus its first three', () => {
  const t = trailing(periods(calendar), { asOf: '2026-10-02' });
  // Q4 2025 = 5.0 − (1.0 + 1.1 + 1.2) = 1.7; TTM = Q3 1.2 + Q4 1.7 + Q1 1.3 + Q2 1.4
  assert.equal(t.basis, 'ttm');
  assert.equal(Number(t.value.toFixed(4)), 5.6);
  assert.equal(t.end, '2026-06-30');
  assert.equal(t.form, '10-Q');
  assert.equal(t.accn, 'Q-2026-2');
  assert.deepEqual(t.parts.map((p) => p.end), ['2025-09-30', '2025-12-31', '2026-03-31', '2026-06-30']);
  assert.ok(t.parts[1].derived);
});

test('a restated period keeps the later filing; a 20-F filer has its fiscal year', () => {
  const p = periods([e('2026-01-01', '2026-03-31', 1.0, '10-Q', '2026-05-01'), e('2026-01-01', '2026-03-31', 0.9, '10-Q/A', '2026-07-01')]);
  assert.equal(p.length, 1);
  assert.equal(p[0].val, 0.9);
  const annual = trailing(periods([e('2024-01-01', '2024-12-31', 40, '20-F', '2025-04-17'), e('2025-01-01', '2025-12-31', 66.3, '20-F', '2026-04-16', '20F-2025')]), { asOf: '2026-10-02' });
  assert.deepEqual([annual.basis, annual.value, annual.form, annual.end], ['annual', 66.3, '20-F', '2025-12-31']);
  // nothing newer than fifteen months: no EPS rather than an old one
  assert.equal(trailing(periods([e('2023-01-01', '2023-12-31', 3, '10-K')]), { asOf: '2026-10-02' }), null);
});

test('P/E: a loss says so; market cap and yield from the price', () => {
  assert.deepEqual(valuationFor({ eps: { value: -2.1 }, shares: { value: 1e6 } }, 10), { pe: 'loss', marketCap: 1e7, dividendYield: null });
  assert.deepEqual(valuationFor({ eps: { value: 0 } }, 10).pe, 'loss');
  assert.deepEqual(valuationFor({ eps: { value: 5 }, div: { value: 1 }, shares: { value: 100 } }, 200), { pe: 40, marketCap: 20000, dividendYield: 0.005 });
  assert.deepEqual(valuationFor({ eps: { value: 5 } }, null), { pe: null, marketCap: null, dividendYield: null });
});

test('shares: the newest filing, classes summed; Berkshire A counted as 1,500 B', () => {
  const facts = {
    dei: {
      EntityCommonStockSharesOutstanding: {
        units: {
          shares: [
            { end: '2026-04-20', val: 999, accn: 'old', filed: '2026-04-25', form: '10-Q' },
            { end: '2026-07-20', val: 1_300_000_000, accn: 'new', filed: '2026-08-01', form: '10-Q' },
            { end: '2026-07-20', val: 500_000, accn: 'new', filed: '2026-08-01', form: '10-Q' },
          ],
        },
      },
    },
  };
  assert.equal(sharesOutstanding(facts).value, 1_300_500_000, 'equal-economics classes are summed');
  assert.equal(sharesOutstanding(facts).classes, 2);
  assert.equal(sharesOutstanding(facts, { classes: [{ below: 5e6, ratio: 1500 }] }).value, 1_300_000_000 + 500_000 * 1500);
  assert.equal(sharesOutstanding(facts, { classes: [{ below: 5e6, ratio: 1500 }], divideAll: 1500 }).value, Math.round((1_300_000_000 + 750_000_000) / 1500));
});

test('a foreign filer: EPS in its currency → dollars per ADS; no rate → "—" with the reason', () => {
  const cf = {
    facts: {
      'ifrs-full': { DilutedEarningsLossPerShare: { units: { 'TWD/shares': [e('2025-01-01', '2025-12-31', 66.3, '20-F', '2026-04-16', '0001628280-26-025362')] } } },
      dei: { EntityCommonStockSharesOutstanding: { units: { shares: [{ end: '2026-02-28', val: 25_930_000_000, accn: 'x', filed: '2026-04-16', form: '20-F' }] } } },
    },
  };
  const rec = fundamentalsOf(cf, { cik: '1046179', fx: (v, cur) => (cur === 'TWD' ? v * 0.0314 : null), adrRatio: 5, asOf: '2026-10-02' });
  assert.equal(rec.eps.value, Number((66.3 * 0.0314 * 5).toFixed(4)));
  assert.equal(rec.eps.basis, 'annual');
  assert.equal(rec.eps.perAds, 5);
  assert.equal(rec.eps.local, 66.3);
  assert.equal(rec.shares.value, 25_930_000_000 / 5);
  assert.equal(rec.eps.url, filingUrl('1046179', '0001628280-26-025362'));
  const none = fundamentalsOf(cf, { cik: '1046179', fx: () => null, adrRatio: 5, asOf: '2026-10-02' });
  assert.equal(none.eps.value, null);
  assert.match(none.eps.reason, /TWD → USD kuru yok/);
});

test('the concepts are tried in order and only per-share units count', () => {
  const facts = { 'us-gaap': { EarningsPerShareBasic: { units: { 'USD/shares': calendar } }, EarningsPerShareDiluted: { units: { USD: calendar } } } };
  const t = trailingOf(facts, EPS_CONCEPTS, { asOf: '2026-10-02' });
  assert.equal(t.concept, 'us-gaap:EarningsPerShareBasic', 'a "USD" unit (not per share) is skipped');
  assert.equal(filingUrl('320193', '0000320193-26-000077'), 'https://www.sec.gov/Archives/edgar/data/320193/000032019326000077/0000320193-26-000077-index.htm');
});

test('beta: weekly returns over two years against SPY', () => {
  const spy = [];
  const twice = [];
  let t = Date.parse('2024-09-02T00:00:00Z');
  let a = 100;
  let b = 100;
  let i = 0;
  while (t < Date.parse('2026-10-01T00:00:00Z')) {
    const d = new Date(t).toISOString().slice(0, 10);
    const r = Math.sin(i++ / 3) / 100;
    a *= 1 + r;
    b *= 1 + 2 * r;
    spy.push({ date: d, close: a });
    twice.push({ date: d, close: b });
    t += 86400000;
  }
  const beta = weeklyBeta(twice, spy);
  assert.ok(beta > 1.8 && beta < 2.3, `beta ${beta}`);
  assert.equal(weeklyBeta(twice.slice(-60), spy), null, 'under a year of weeks: no beta');
});

test('no cover count (a multi-class filer) or a stale / off-scale one: the diluted share count', () => {
  const wavg = { WeightedAverageNumberOfDilutedSharesOutstanding: { units: { shares: [e('2026-04-01', '2026-06-30', 12_100_000_000)] } } };
  // Alphabet: classes tagged per class, no plain cover count in companyfacts
  const g = sharesOutstanding({ 'us-gaap': wavg }, null, { asOf: '2026-10-02' });
  assert.deepEqual([g.value, g.basis, g.asOf], [12_100_000_000, 'weighted-average', '2026-06-30']);
  // a cover count ten times off the income statement's (Alibaba): not used
  const off = { 'us-gaap': wavg, dei: { EntityCommonStockSharesOutstanding: { units: { shares: [{ end: '2026-03-31', val: 1_210_000_000, accn: 'c', filed: '2026-05-20', form: '20-F' }] } } } };
  assert.equal(sharesOutstanding(off, null, { asOf: '2026-10-02' }).basis, 'weighted-average');
  // a stale cover count (Sony's from 2019): not used
  const old = { 'us-gaap': wavg, dei: { EntityCommonStockSharesOutstanding: { units: { shares: [{ end: '2019-03-31', val: 12_000_000_000, accn: 'o', filed: '2019-06-18', form: '20-F' }] } } } };
  assert.equal(sharesOutstanding(old, null, { asOf: '2026-10-02' }).basis, 'weighted-average');
  // a recent cover count that agrees wins
  const good = { 'us-gaap': wavg, dei: { EntityCommonStockSharesOutstanding: { units: { shares: [{ end: '2026-07-20', val: 12_050_000_000, accn: 'g', filed: '2026-07-25', form: '10-Q' }] } } } };
  assert.equal(sharesOutstanding(good, null, { asOf: '2026-10-02' }).value, 12_050_000_000);
});

test('no EPS concept (Berkshire): net income over the diluted shares, then the class rule', () => {
  const q = (s0, e0, v) => e(s0, e0, v);
  const facts = {
    'us-gaap': {
      NetIncomeLoss: { units: { USD: [q('2025-07-01', '2025-09-30', 10e9), q('2025-01-01', '2025-12-31', 40e9, '10-K', '2026-02-28'), q('2025-01-01', '2025-03-31', 8e9), q('2025-04-01', '2025-06-30', 12e9), q('2026-01-01', '2026-03-31', 9e9), q('2026-04-01', '2026-06-30', 11e9)] } },
      WeightedAverageNumberOfSharesOutstandingBasic: { units: { shares: [q('2026-04-01', '2026-06-30', 1_440_000)] } },
    },
  };
  const a = fundamentalsOf({ facts }, { cik: '1067983', classRule: { classes: [{ below: 5e6, ratio: 1500 }], divideAll: 1500 }, asOf: '2026-10-02' });
  // TTM net income 10 + (40−30) + 9 + 11 = 40 B; per Class A share 40e9 / 1.44 M
  assert.equal(Math.round(a.eps.value), Math.round(40e9 / 1_440_000));
  assert.equal(a.eps.derivedFrom, 'net-income');
  const b = fundamentalsOf({ facts }, { cik: '1067983', classRule: { classes: [{ below: 5e6, ratio: 1500 }], epsDivisor: 1500 }, asOf: '2026-10-02' });
  assert.equal(Number(b.eps.value.toFixed(2)), Number((40e9 / 1_440_000 / 1500).toFixed(2)));
  assert.equal(b.shares.value, 1_440_000 * 1500, 'Class A equivalents counted as Class B');
});

test('a re-registered filer: the old CIK\'s periods carry the trailing four quarters', () => {
  const now = { facts: { 'us-gaap': { EarningsPerShareDiluted: { units: { 'USD/shares': [e('2026-04-01', '2026-06-30', 3.48)] } } } } };
  const old = { facts: { 'us-gaap': { EarningsPerShareDiluted: { units: { 'USD/shares': [e('2025-01-01', '2025-03-31', 1.7), e('2025-04-01', '2025-06-30', 1.64), e('2025-07-01', '2025-09-30', 1.8), e('2025-01-01', '2025-12-31', 6.8, '10-K', '2026-02-20'), e('2026-01-01', '2026-03-31', 1.9)] } } } } };
  const t = trailingOf(mergeFacts(now, old).facts, EPS_CONCEPTS, { asOf: '2026-10-02' });
  assert.equal(t.basis, 'ttm');
  assert.equal(Number(t.value.toFixed(2)), Number((1.8 + (6.8 - 1.7 - 1.64 - 1.8) + 1.9 + 3.48).toFixed(2)));
});
