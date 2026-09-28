// The market check for foreign issuers' Form 4 lines (fpiNormalize.js): the
// form's price is taken in US dollars as it stands when it lands within ±15%
// of the trade day's US close; only otherwise is it converted or divided by
// an ADR ratio, and a line nothing fits has no dollar amount.
//
// Real lines (tests/fixtures/fpi-market-cases.json, frozen 2026-09-28):
//   A  a dollar price read as another currency — Merus ($97 tender offer,
//      "nominal value EUR 0.09"), SMFG ("converted into U.S. dollars", read
//      as yen), Arm ("nominal value 0.001 GBP"), Aptose ("C$1.4 = US$1.00"),
//      HIVE (a C$ price range, the form in dollars), Turbo Energy ("par
//      value … euro"), Kidoz ("approximately US$0.249"), Star Bulk
//      ("equivalent $28.27")
//   B  an ADR ratio applied to a dollar price that already matches the
//      close — Summit, Indivior, Tiziana, MDxHealth, OKYO, AVITA,
//      AstraZeneca (no ADS programme any more), Sequans, Nexxen, Oatly;
//      SaverOne's ratio read as 43.2 instead of 43,200
//   kept: CEMEX, 51Talk (a price per ADS for a count in home shares), BBD,
//      TSMC (tests/fpi-cases.test.mjs)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeRow, normalizeRows, declaredCurrency, figureCurrency, withoutParValue, foreignOn, securityKind, usdValue, MATCH_TOLERANCE } from '../api/_lib/fpiNormalize.js';
import { daySummary } from '../api/_lib/insiderModel.js';
import { buildClusters } from '../api/_lib/insiderCluster.js';

const F = JSON.parse(fs.readFileSync(new URL('./fixtures/fpi-market-cases.json', import.meta.url)));
const OVERRIDES = JSON.parse(fs.readFileSync(new URL('../config/adr-overrides.json', import.meta.url))).byTicker;
const run = (key) => {
  const c = F.cases[key];
  const t = key.split('_')[0];
  return normalizeRow(c.row, { raw: c.raw, issuer: c.issuer, override: OVERRIDES[t] || null, rates: F.rates, series: c.close ? [c.close] : null, splits: {} });
};
const formValue = (key) => Math.round(F.cases[key].row.s * F.cases[key].row.p);

// ------------------------------------------------------------ synthetic
const ADS5 = { t: 'XYZ', fpi: 1, ads: 1, cur: 'MXN', ratio: 5, src: 'f6' };
const RATES = { MXN: [['2026-09-25', 0.05]] };
const line = (p, s = 1000) => ({ t: 'XYZ', ci: '9', n: 'A Director', r: 'director', d: '2026-09-25', f: '2026-09-26', k: 'P', s, p, v: Math.round(s * p), a: 'X', li: 0 });

test('the threshold is ±15%', () => {
  assert.equal(MATCH_TOLERANCE, 0.15);
});

test('synthetic 1 — already in dollars: the price is within ±15% of the close → no conversion, no ADR ratio', () => {
  const n = normalizeRow(line(20.5), { raw: { st: 'Ordinary Shares' }, issuer: ADS5, rates: RATES, series: [{ date: '2026-09-25', close: 20 }] });
  assert.deepEqual([n.ok, n.cu, n.ar, n.as, n.p, n.s, n.v], [1, 'USD', 1, 'asis', 20.5, 1000, 20500]);
});

test('synthetic 2 — conversion needed: 80 pesos × 0.05 × 5 = $20 per ADS, the form price itself is far off', () => {
  const n = normalizeRow(line(80, 5000), { raw: { st: 'Ordinary Shares' }, issuer: ADS5, rates: RATES, series: [{ date: '2026-09-25', close: 20.4 }] });
  assert.deepEqual([n.ok, n.cu, n.ar, n.as, n.p, n.s, n.v], [1, 'MXN', 5, 'f6', 20, 1000, 20000]);
});

test('synthetic 3 — nothing within ±15%: no dollar amount, out of the day total and the clusters', () => {
  // as is: 30 vs 20 (+50%); × 5 as dollars: 150; as pesos: 30 × 0.05 × 5 = 7.5; per ADS in pesos: 1.5
  const bad = normalizeRow(line(30), { raw: { st: 'Ordinary Shares' }, issuer: ADS5, rates: RATES, series: [{ date: '2026-09-25', close: 20 }] });
  assert.equal(bad.fail, 'mismatch');
  // 17% off in dollars (fitted the old ±25%), 29% off in euros: neither within ±15%
  const eur = { t: 'XYZ', fpi: 1, ads: 0, cur: 'EUR' };
  assert.equal(normalizeRow(line(23.4), { raw: { st: 'Ordinary Shares' }, issuer: eur, rates: { EUR: [['2026-09-25', 1.1]] }, series: [{ date: '2026-09-25', close: 20 }] }).fail, 'mismatch');
  const issuers = { 9: ADS5 };
  const rows = normalizeRows([line(30), { ...line(20), n: 'B Director', a: 'Y' }, { ...line(20), n: 'C Director', a: 'Z' }], { fpi: { issuers, rates: RATES }, rawOf: () => ({ st: 'Ordinary Shares' }), seriesFor: () => [{ date: '2026-09-25', close: 20 }] });
  assert.equal(usdValue(rows[0]), null);
  const day = daySummary(rows);
  assert.deepEqual([day.buyCount, day.buyValue, day.fxExcluded], [2, 40000, 1]);
  const cl = buildClusters(rows).byTicker.get('XYZ');
  assert.equal(cl.insiders, 2, 'the unverified buyer does not count');
});

test('no daily close: the declared currency and documented ratio as before (the 52-week range still checks)', () => {
  const n = normalizeRow(line(80, 5000), { raw: { st: 'Ordinary Shares', fn: { F1: 'Price in Mexican pesos.' } }, issuer: ADS5, rates: RATES });
  assert.deepEqual([n.cu, n.ar], ['MXN', 5]);
});

// ------------------------------------------------------------ rules
test('a par or nominal value names no price currency', () => {
  assert.equal(withoutParValue('common shares, nominal value EUR 0.09 per share (the "Common Shares")').includes('EUR'), false);
  assert.equal(withoutParValue('Ordinary shares, nominal value 0.001 GBP per share ("Ordinary Shares")').includes('GBP'), false);
  assert.equal(withoutParValue('five Ordinary Shares, par value five cents of euro ((euro)0.05) per share.').includes('euro'), false);
});

test('a footnote amount equal to the price declares its currency; a rate or a range does not', () => {
  assert.equal(figureCurrency('at CAD$0.34 (approximately US$0.249) on the 3rd of March 2026', 0.25), 'USD');
  assert.equal(figureCurrency('offering price of euro 24.50 per share (or equivalent $28.27 per share)', 28.27), 'USD');
  assert.equal(figureCurrency('prices ranging from $17.20 MXN to $17.34 MXN per Ordinary Participation Certificate', 17.2812), null);
  assert.equal(figureCurrency('at a price of A$0.38 per CDI (equivalent to A$3.80 per share, or approximately US$2.70 per share)', 2.7), 'USD');
  // Gerdau: the rate R$5.1017 equals a 5.10 price — "translated into U.S. dollars" decides first
  assert.equal(declaredCurrency({ fn: { F1: 'The price is denominated in Brazilian reais and has been translated into U.S. dollars at the August 6, 2026 selling rate of R$5.1017 per US$1.00.' } }, 5.1), 'USD');
  assert.equal(declaredCurrency({ fn: { F1: 'Converted from Canadian price of C$2.41 per share using an exchange rate of C$1.4 = US$1.00.' } }, 1.72), 'USD');
  assert.equal(declaredCurrency({ fn: { F1: 'The purchase price was paid in New Israeli Shekels (NIS). The exchange rate in effect on the transaction date was 3.038 ILS to $1.00.' } }, 42.9098), null);
});

test('a foreign issuer is one with a 20-F, 40-F or 6-K in the 24 months before the trade', () => {
  assert.equal(foreignOn({ fpi: 1 }, '2026-09-01'), true, 'no date recorded yet: foreign');
  assert.equal(foreignOn({ fpi: 1, lf: '2025-03-01' }, '2026-09-01'), true);
  assert.equal(foreignOn({ fpi: 1, lf: '2021-03-01' }, '2026-09-01'), false);
  assert.equal(foreignOn(null, '2026-09-01'), false);
  // a former foreign issuer's old ratio is not applied: Summit-like, price = close
  const old = { t: 'OLD', fpi: 1, lf: '2020-06-30', ads: 1, ratio: 5, cur: 'GBP', src: '20f' };
  const r = { ...line(18.74), t: 'OLD' };
  assert.equal(normalizeRow(r, { raw: { st: 'Common Stock' }, issuer: old, rates: {}, series: [{ date: '2026-09-25', close: 18.74 }] }), null);
});

test('"ADSs" and "American Depository Shares" are ADS titles; a US bank\'s preferred "DEPOSITORY SHARES" is not', () => {
  assert.equal(securityKind('ADSs'), 'ads');
  assert.equal(securityKind('American Depository Shares'), 'ads');
  assert.notEqual(securityKind('DEPOSITORY SHARES'), 'ads');
});

// ------------------------------------------------------------ A: currency
test('A — a dollar price is no longer read as euros, pounds, yen or Canadian dollars', () => {
  // Merus: $97 tender offer (was $155.8M "in euros" for eight lines)
  assert.equal(run('MRUS'), null, 'Merus: left in dollars');
  // Arm, HIVE, Turbo Energy, Star Bulk: the form's price matches the close
  for (const k of ['ARM', 'HIVE', 'TURB', 'SBLK']) {
    const n = run(k);
    assert.deepEqual([k, n.ok, n.cu, n.ar, n.v], [k, 1, 'USD', 1, formValue(k)]);
  }
  // Aptose and Kidoz: dollars declared, no ADS — served as filed
  assert.equal(run('APTO'), null);
  assert.equal(run('KDOZF'), null);
  // Gerdau "translated into U.S. dollars"; Nayax "paid in NIS" at a dollar price
  for (const k of ['GGB', 'NYAX']) assert.deepEqual([k, run(k).cu, run(k).v], [k, 'USD', formValue(k)]);
});

test('A — SMFG: "converted into U.S. dollars" is never retried as yen; no documented ratio fits → no dollar amount', () => {
  const n = run('SMFG');
  assert.equal(n.fail, 'mismatch');
  assert.equal(n.lp, 43.99);
});

// ------------------------------------------------------------ B: ADR ratio
test('B — a dollar price equal to the close keeps its share count (no ADS programme, or ADS title)', () => {
  for (const k of ['SMMT', 'INDV', 'TLSA', 'MDXH', 'OKYO', 'RCEL', 'AZN', 'SQNS', 'NEXN', 'OTLY']) {
    const n = run(k);
    assert.deepEqual([k, n.cu, n.ar, n.as, n.v], [k, 'USD', 1, 'asis', formValue(k)], k);
  }
  // Summit's $10M placement by Xia Yu (was shown as $2M)
  assert.equal(run('SMMT').v, 9999983);
});

test('B — kept: a price per ADS with the count in home shares (CEMEX override, 51Talk footnote)', () => {
  const cx = run('CX_F');
  assert.deepEqual([cx.cu, cx.ar, cx.pa, cx.s], ['USD', 10, 1, 13042]);
  const coe = run('COE');
  assert.deepEqual([coe.cu, coe.ar, coe.pa, coe.s], ['USD', 60, 1, 1000]);
});

test('B — SaverOne: 43,200 ordinary shares per ADS (reviewed override), not 43.2', () => {
  const n = run('SVRE');
  assert.equal(n.ar, 43200);
  assert.equal(n.s, 6039);
  assert.ok(n.v < 20000, `≈ $16K, not $15.9M (${n.v})`);
});

test('no footnote, ordinary-share title, price at the ADS close: taken as it stands (Alibaba) — the rule, flagged in the report', () => {
  const n = run('BABA');
  assert.deepEqual([n.cu, n.ar, n.as], ['USD', 1, 'asis']);
});
