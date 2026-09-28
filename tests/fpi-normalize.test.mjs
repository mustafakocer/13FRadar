// Foreign private issuers' Form 4 lines in US dollars (roadmap item 4):
// exchange rates, ADR ratios, the per-line normalisation, and what an
// unconvertible line does to totals and rankings. Real SEC cases (CX, BBD,
// TSM, BABA, ASX, GGAL, VIPS, DFDV, NCT) are in fpi-cases.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFredCsv, usdPerUnit, currencyOf } from '../api/_lib/fx.js';
import { parseRatios, statedRatio, snapRatio, deriveRatio } from '../api/_lib/adrRatio.js';
import { normalizeRow, normalizeRows, securityKind, usdValue } from '../api/_lib/fpiNormalize.js';
import { daySummary, findClusters } from '../api/_lib/insiderModel.js';
import { buildTeaser } from '../api/_lib/insiderTeaser.js';
import { categorize } from '../api/_lib/insiderClassify.js';
import { priceCheck } from '../api/_lib/insiderPriceCheck.js';

test('FRED CSV: holidays dropped, quoted either way round → USD per unit', () => {
  const mxn = parseFredCsv('observation_date,DEXMXUS\n2026-09-24,18.40\n2026-09-25,.\n2026-09-23,18.50\n', false);
  assert.deepEqual(mxn.map((x) => x[0]), ['2026-09-23', '2026-09-24']);
  assert.ok(Math.abs(mxn[1][1] - 1 / 18.4) < 1e-6);
  const eur = parseFredCsv('observation_date,DEXUSEU\n2026-09-24,1.1\n', true);
  assert.equal(eur[0][1], 1.1);
});

test('rate on the trade day, else the last one within a week; none for H.10-less currencies', () => {
  const rates = { MXN: [['2026-09-18', 0.05], ['2026-09-24', 0.054]] };
  assert.equal(usdPerUnit('MXN', '2026-09-24', rates), 0.054);
  assert.equal(usdPerUnit('MXN', '2026-09-27', rates), 0.054, 'weekend: Friday rate');
  assert.equal(usdPerUnit('MXN', '2026-09-20', rates), 0.05);
  assert.equal(usdPerUnit('MXN', '2026-10-15', rates), null, 'stale by three weeks');
  assert.equal(usdPerUnit('MXN', '2026-09-01', rates), null, 'before the series');
  assert.equal(usdPerUnit('USD', '2026-09-01', rates), 1);
  assert.equal(usdPerUnit('ILS', '2026-09-24', rates), null, 'H.10 has no shekel');
  assert.ok(Math.abs(usdPerUnit('GBX', '2026-09-24', { GBP: [['2026-09-24', 1.3]] }) - 0.013) < 1e-9, 'pence');
});

test('currency named in a footnote', () => {
  assert.equal(currencyOf('Price in Mexican Pesos (MXN).'), 'MXN');
  assert.equal(currencyOf('The option exercise price reflects New Taiwan dollars.'), 'TWD');
  assert.equal(currencyOf('Price per share in Brazilian reais (R$).'), 'BRL');
  assert.equal(currencyOf('prices ranging from HK$10.20 to HK$10.40'), 'HKD');
  assert.equal(currencyOf('Argentine pesos'), 'ARS', 'not Mexican');
  assert.equal(currencyOf('price in U.S. dollars'), 'USD');
  assert.equal(currencyOf('The reported price is a weighted average price.'), null);
  assert.equal(currencyOf('shares held by the Real Estate Trust'), null, 'not the Brazilian real');
});

test('ADR ratio statements', () => {
  const r = (t) => statedRatio(t)?.ratio;
  assert.equal(r('Each ADS represents 8 ordinary shares.'), 8);
  assert.equal(r('American Depositary Shares, each representing five (5) common shares'), 5);
  assert.equal(r('American Depositary Shares, each representing one-fifth of one Class A ordinary share'), 0.2);
  assert.equal(r('five ADSs represent one ordinary share'), 0.2);
  assert.equal(r('ADSs each representing ten (10) CPOs'), 10);
  assert.equal(statedRatio('American Depositary Shares (each representing 1 preferred share)').underlying, 'preferred');
  assert.equal(r('The reporting person holds 1,200 ADSs.'), undefined);
  assert.equal(parseRatios('').length, 0);
});

test('derived ratio: only within ±10% of a common ratio', () => {
  assert.equal(snapRatio(4.8), 5);
  assert.equal(snapRatio(0.21), 0.2);
  assert.equal(snapRatio(7), null, 'between 6 and 8: not accepted');
  // TSM-like: ADS $300, share NT$1,900 at 31.6 TWD/USD → 4.99
  assert.equal(deriveRatio(300, 1900, 1 / 31.6), 5);
  assert.equal(deriveRatio(300, 1900, null), null);
});

test('security kind from the Form 4 title', () => {
  assert.equal(securityKind('Variable Rate Series C Perpetual Preferred Stock'), 'preferred');
  assert.equal(securityKind('Preference shares - BBDC4', { und: 'preferred' }), 'share', "Bradesco's ADS is the preferred share");
  assert.equal(securityKind('Series A Perpetual Strike Preferred Stock', { und: 'preferred' }), 'preferred');
  assert.equal(securityKind('American Depositary Shares'), 'ads');
  assert.equal(securityKind('Ordinary Participation Certificates (CEMEX.CPO)'), 'share');
  assert.equal(securityKind('Common Units'), 'share');
  assert.equal(securityKind('Warrants to purchase Class A Common Stock'), 'other');
  assert.equal(securityKind('Units'), 'other');
  assert.equal(securityKind(null), null);
});

// a CEMEX-like issuer and a peso rate
const RATES = { MXN: [['2026-09-25', 0.0536]], TWD: [['2026-09-07', 0.0317]], BRL: [['2026-09-18', 0.19]] };
const CEMEX = { t: 'CX', fpi: 1, ads: 1, cur: 'MXN', ratio: 10, und: 'cpo', src: 'f6', url: 'https://www.sec.gov/x', quote: 'each ADS represents ten CPOs' };
const cxRow = { t: 'CX', ci: '0001076378', n: 'Zambrano Lozano Rogelio', r: 'director', d: '2026-09-25', f: '2026-09-26', k: 'P', s: 400800, p: 17.2812, v: 6926305, o: 1000000, a: 'A1', li: 0 };
const cxRaw = { st: 'Ordinary Participation Certificates (CEMEX.CPO)', fn: { F1: 'Price per Ordinary Participation Certificate.', F2: 'Price in Mexican Pesos (MXN).' } };

test('a peso line becomes US dollars per ADS when it matches the close', () => {
  const series = [{ date: '2026-09-25', close: 9.4 }];
  const n = normalizeRow(cxRow, { raw: cxRaw, issuer: CEMEX, rates: RATES, series });
  assert.equal(n.ok, 1);
  assert.equal(n.cu, 'MXN');
  assert.equal(n.ar, 10);
  assert.equal(n.as, 'f6');
  // 17.2812 MXN × 0.0536 × 10 = $9.26 per ADS; 400,800 CPOs = 40,080 ADSs
  assert.ok(Math.abs(n.p - 9.263) < 0.01);
  assert.equal(n.s, 40080);
  assert.equal(n.v, Math.round(400800 * 17.2812 * 0.0536));
  assert.ok(n.v > 350000 && n.v < 400000, `~$371K, not $6.9M (${n.v})`);
});

test('no reading that fits the market → kept in pesos, no dollar amount', () => {
  const series = [{ date: '2026-09-25', close: 30 }];
  const n = normalizeRow(cxRow, { raw: cxRaw, issuer: CEMEX, rates: RATES, series });
  assert.equal(n.fail, 'mismatch');
  assert.equal(n.cu, 'MXN');
  assert.equal(n.lv, Math.round(400800 * 17.2812));
  const [row] = normalizeRows([cxRow], { fpi: { issuers: { [cxRow.ci]: CEMEX }, rates: RATES }, rawOf: () => cxRaw, seriesFor: () => series });
  assert.equal(row.v, null);
  assert.equal(usdValue(row), null);
  assert.deepEqual(priceCheck(row, { current: 9.7 }), { ok: false, reason: 'currency' });
});

test('no rate for the currency → not converted (never guessed)', () => {
  const n = normalizeRow(cxRow, { raw: cxRaw, issuer: CEMEX, rates: {}, series: [{ date: '2026-09-25', close: 9.4 }] });
  assert.equal(n.fail, 'no_rate');
});

test('no market data: a stated currency and a documented ratio are taken as they stand; a derived one is not', () => {
  assert.equal(normalizeRow(cxRow, { raw: cxRaw, issuer: CEMEX, rates: RATES }).ok, 1);
  const noDoc = { ...CEMEX, ratio: null, src: null, der: { ratio: 10, cur: 'MXN', n: 5, agree: 5 } };
  assert.equal(normalizeRow(cxRow, { raw: cxRaw, issuer: noDoc, rates: RATES }).fail, 'unverifiable');
  // a weakly supported derived ratio is not used at all
  const weak = { ...noDoc, der: { ratio: 10, cur: 'MXN', n: 5, agree: 2 } };
  assert.equal(normalizeRow(cxRow, { raw: cxRaw, issuer: weak, rates: RATES }).fail, 'no_ratio');
});

test('ratio unknown: derived from the close, within ±10% of a common ratio, marked "derived"', () => {
  const noRatio = { ...CEMEX, ratio: null, src: null };
  const n = normalizeRow(cxRow, { raw: cxRaw, issuer: noRatio, rates: RATES, series: [{ date: '2026-09-25', close: 9.4 }] });
  assert.equal(n.as, 'derived');
  assert.equal(n.ar, 10);
});

test('the 52-week range stands in for a missing daily close', () => {
  const meta = { lo: 8.7, hi: 13.7, asOf: '2026-09-25' };
  assert.equal(normalizeRow(cxRow, { raw: cxRaw, issuer: CEMEX, rates: RATES, meta }).ok, 1);
  assert.equal(normalizeRow(cxRow, { raw: cxRaw, issuer: CEMEX, rates: RATES, meta: { lo: 40, hi: 60, asOf: '2026-09-25' } }).fail, 'mismatch');
});

test('a domestic line is served untouched', () => {
  const r = { t: 'AAPL', ci: '0000320193', d: '2026-09-01', k: 'S', s: 100, p: 230, v: 23000, a: 'X', li: 0 };
  assert.equal(normalizeRow(r, { raw: { st: 'Common Stock' } }), null);
  const [out] = normalizeRows([r], { rawOf: () => ({ st: 'Common Stock' }) });
  assert.equal(out, r);
});

test('preferred stock that is not the quoted security: own category, no return', () => {
  const r = { t: 'DFDV', ci: '1', d: '2026-09-17', k: 'P', s: 1000, p: 8.96, v: 8960, a: 'P1', li: 0 };
  const [out] = normalizeRows([r], { rawOf: () => ({ st: 'Variable Rate Series C Perpetual Preferred Stock' }) });
  assert.equal(out.sk, 'preferred');
  assert.equal(categorize(out), 'preferred');
  assert.deepEqual(priceCheck(out, { current: 6 }), { ok: false, reason: 'security' });
});

test('an unconverted line stays out of rankings and day totals, and is counted', () => {
  const day = { d: '2026-09-25', f: '2026-09-26', k: 'P', r: 'director' };
  const good = { ...day, t: 'AAA', n: 'A One', s: 1000, p: 50, v: 50000, a: 'G1', li: 0 };
  const good2 = { ...day, t: 'AAA', n: 'A Two', s: 1000, p: 50, v: 50000, a: 'G2', li: 0 };
  const bad = { ...day, t: 'AAA', n: 'Peso Person', s: 400800, p: 17.28, v: null, pu: 1, fx: { cu: 'MXN', lp: 17.28, lv: 6926305, fail: 'mismatch' }, a: 'B1', li: 0 };
  const s = daySummary([good, good2, bad]);
  assert.equal(s.buyCount, 2);
  assert.equal(s.buyValue, 100000);
  assert.equal(s.fxExcluded, 1);
  const cl = findClusters([good, good2, bad]).get('AAA');
  assert.equal(cl.insiders, 3, 'the cluster rule itself is unchanged (item 3)');
  assert.equal(cl.value, 100000);
  assert.equal(cl.fxExcluded, 1);
  const t = buildTeaser([good, good2, { ...bad, t: 'BBB' }], {}, {}, Date.parse('2026-09-27'));
  assert.equal(t.highlight.t, 'AAA', 'the unconverted line never takes the highlight');
  assert.equal(t.pulse.fxExcluded, 1);
  assert.equal(t.pulse.buyValue, 100000);
  const bbb = t.rows.find((r) => r.t === 'BBB');
  assert.deepEqual([bbb.v, bbb.fx.cu, bbb.fx.lv], [null, 'MXN', 6926305]);
});

test('Federal Reserve H.10 download and ECB rates → USD per unit', async () => {
  const { parseFedH10Csv, parseEcb } = await import('../api/_lib/fx.js');
  const csv = [
    '"Series Description","Spot exchange rate - Mexico","Spot exchange rate - Euro area"',
    '"Unit:","Currency:_Per_USD","USD:_Per_Currency"',
    '"Unique Identifier:","H10/H10/RXI_N.B.MX","H10/H10/RXI$US_N.B.EU"',
    '"Time Period","RXI_N.B.MX","RXI$US_N.B.EU"',
    '2026-09-24,18.40,1.10',
    '2026-09-25,ND,1.11',
  ].join('\n');
  const r = parseFedH10Csv(csv);
  assert.equal(r.MXN.length, 1, '"ND" (no data) dropped');
  assert.ok(Math.abs(r.MXN[0][1] - 1 / 18.4) < 1e-6);
  assert.deepEqual(r.EUR.map((x) => x[1]), [1.1, 1.11]);
  const e = parseEcb({ rates: { '2026-09-24': { ILS: 3.7 } } });
  assert.ok(Math.abs(e.ILS[0][1] - 1 / 3.7) < 1e-6);
});

test('a note saying the price was converted INTO dollars is a dollar price (TSMC, Galicia)', () => {
  assert.equal(currencyOf('The price was translated from New Taiwan dollars, NT$1,795, at the rate of NT$32.092 to US$1.'), 'USD');
  assert.equal(currencyOf('Reported prices have been converted from Argentine pesos to U.S. dollars using an exchange rate of US$0.00067 per Argentine peso.'), 'USD');
  assert.equal(currencyOf('The option exercise price reflects New Taiwan dollars.'), 'TWD');
});

test('price per ADS with the share count in CPOs (CEMEX sale of 21,268 ADSs filed as 212,680 CPOs)', () => {
  const r = { ...cxRow, d: '2026-08-19', k: 'S', s: 212680, p: 10.68, v: 2271422 };
  const raw = { st: 'Ordinary Participation Certificates (CEMEX.CPO)', fn: { F1: 'On August 19, 2026, the reporting person effected a sale of 21,268 American Depositary Shares ("ADSs"). Each ADS represents 10 Ordinary Participation Certificates.', F2: 'Price per ADS.' } };
  const n = normalizeRow(r, { raw, issuer: CEMEX, rates: { MXN: [['2026-08-19', 0.054]] }, series: [{ date: '2026-08-19', close: 10.66 }] });
  assert.deepEqual([n.ok, n.cu, n.p, n.s, n.pa], [1, 'USD', 10.68, 21268, 1]);
  assert.equal(n.v, Math.round(21268 * 10.68), '$227K, not $2.27M');
});

test('documented ratio first even when a derived one sits closer (TSMC ADS premium)', () => {
  const tsmc = { t: 'TSM', fpi: 1, ads: 1, cur: 'TWD', ratio: 5, src: 'f6', der: { ratio: 6, cur: 'USD', n: 150, agree: 147 } };
  const r = { t: 'TSM', ci: '1', d: '2026-03-22', k: 'P', s: 1000, p: 55.93, v: 55930, a: 'T', li: 0 };
  const raw = { st: 'Common Shares (2330.TW)', fn: { F1: 'The price was translated from New Taiwan dollars, NT$1,795, at the rate of NT$32.092 to US$1.' } };
  const n = normalizeRow(r, { raw, issuer: tsmc, rates: {}, series: [{ date: '2026-03-23', close: 338.45 }] });
  assert.deepEqual([n.cu, n.ar, n.as, n.s], ['USD', 5, 'f6', 200]);
  assert.ok(Math.abs(n.p - 279.65) < 0.01);
  assert.equal(n.v, 55930, 'the dollar amount does not depend on the ratio');
});

test('a stale documented ratio that fails the market gives way to a well-supported derived one (Vipshop)', () => {
  const vips = { t: 'VIPS', fpi: 1, ads: 1, cur: null, ratio: 2, src: 'f6', der: { ratio: 0.2, cur: 'USD', n: 6, agree: 6 } };
  const r = { t: 'VIPS', ci: '1', d: '2026-06-09', k: 'S', s: 2589, p: 69.117, v: 178944, a: 'V', li: 0 };
  const n = normalizeRow(r, { raw: { st: 'Class A ordinary shares' }, issuer: vips, rates: {}, series: [{ date: '2026-06-09', close: 13.57 }] });
  assert.deepEqual([n.cu, n.ar, n.as, n.s], ['USD', 0.2, 'derived', 12945]);
});

test('a dollar-priced company without ADSs is left alone: its mismatch is a split, not a currency (NCT)', () => {
  const nct = { t: 'NCT', fpi: 1, ads: 0, cur: null };
  const r = { t: 'NCT', ci: '1', d: '2026-09-25', k: 'P', s: 1625000, p: 0.4, v: 650000, a: 'N', li: 0 };
  assert.equal(normalizeRow(r, { raw: { st: 'Class B Ordinary Shares' }, issuer: nct, rates: {}, series: [{ date: '2026-09-25', close: 4.43 }] }), null);
});
