// The verified foreign-issuer examples, on real Form 4 lines. Every issuer
// record carries the SEC document its ADR ratio was read from (url) and the
// sentence itself (quote) — the ratios are the filings', not remembered:
//   CX    20-F: "each ADS representing ten CPOs"
//   BBD   20-F: "each representing 1 preferred share" (the ADS IS the preferred)
//   TSM   20-F: "each ADS represents five (5) common shares"
//   BABA  20-F: "American Depositary Shares, each representing eight Ordinary Shares"
//   ASX   20-F: "each representing two Common Shares"
//   VIPS  20-F: "each representing 0.2 Class A ordinary shares"
//   GGAL  no SEC document states a number (its F-6s say "representing Class
//         B Ordinary Shares"): the ratio is DERIVED from the closes (10, 7 of
//         7 lines) and labelled so on the page.
// tests/fixtures/fpi-cases.json was frozen from api/_data/fpi.json and
// api/_data/insiders.json on 2026-09-28; rates as the file has them (H.10,
// ECB for currencies H.10 lacks).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeRow, normalizeRows } from '../api/_lib/fpiNormalize.js';
import { buildClusters } from '../api/_lib/insiderCluster.js';
import { buildTeaser } from '../api/_lib/insiderTeaser.js';
import { categorize } from '../api/_lib/insiderClassify.js';
import { priceCheck } from '../api/_lib/insiderPriceCheck.js';
import { usdPerUnit } from '../api/_lib/fx.js';

const F = JSON.parse(fs.readFileSync(new URL('./fixtures/fpi-cases.json', import.meta.url)));
const { rates } = F;
const run = (key, extra = {}) => {
  const c = F.cases[key];
  return normalizeRow(c.row, { raw: c.raw, issuer: c.issuer, rates, series: c.close ? [c.close] : null, meta: c.meta, splits: {}, ...extra });
};
const sec = (key) => {
  const i = F.cases[key].issuer;
  assert.match(i.url, /^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\//, `${key}: ratio from an SEC filing`);
  return i;
};

test('CX: 400,800 CPOs at 17.28 Mexican pesos → US dollars per ADS (ratio 10, SEC 20-F)', () => {
  const { row } = F.cases.CX;
  const i = sec('CX');
  assert.match(i.quote, /ten CPOs/i);
  const n = run('CX');
  const rate = usdPerUnit('MXN', row.d, rates);
  assert.deepEqual([n.ok, n.cu, n.ar, n.as, n.s], [1, 'MXN', 10, '20f', 40080]);
  assert.equal(n.v, Math.round(400800 * 17.2812 * rate));
  assert.ok(n.v > 350000 && n.v < 420000, `≈ $0.39M, not the $6.93M the site showed (${n.v})`);
  assert.ok(Math.abs(n.p / F.cases.CX.close.close - 1) < 0.1, 'within 10% of the ADS close');
});

test('CX: a sale filed as CPOs at a price "per ADS" — 21,268 ADSs, not 212,680', () => {
  const n = run('CX_ads_sale');
  assert.deepEqual([n.cu, n.p, n.s, n.pa], ['USD', 10.68, 21268, 1]);
});

test('CX in the home page highlight and day total with its US-dollar amount', () => {
  const cx = { ...F.cases.CX.row };
  const other = { t: 'AAA', n: 'Some Director', r: 'director', d: cx.d, f: cx.f, k: 'P', s: 1000, p: 300, v: 300000, a: 'X1', li: 0 };
  const [served] = normalizeRows([cx], { fpi: { issuers: { [cx.ci]: F.cases.CX.issuer }, rates }, rawOf: () => F.cases.CX.raw, seriesFor: () => [F.cases.CX.close] });
  const t = buildTeaser([served, other], {}, {}, Date.parse('2026-09-28'));
  assert.equal(t.highlight.t, 'CX');
  assert.equal(t.highlight.v, served.v);
  assert.equal(t.highlight.fx.cu, 'MXN');
  assert.equal(t.pulse.buyValue, served.v + 300000);
});

test('BBD: preferred shares in reais → US dollars; the cluster total is in dollars', () => {
  const i = sec('BBD');
  assert.equal(i.und, 'preferred');
  const n = run('BBD');
  assert.deepEqual([n.ok, n.cu, n.ar], [1, 'BRL', 1]);
  assert.equal(categorize({ ...F.cases.BBD.row, sk: undefined }), 'open_buy', "Bradesco's preferred is the quoted security, not 'İmtiyazlı hisse alımı'");
  const a = { ...F.cases.BBD.row };
  const b = { ...a, n: 'Another Officer', a: 'B2', s: 60492 };
  const served = normalizeRows([a, b], { fpi: { issuers: { [a.ci]: i }, rates }, rawOf: () => F.cases.BBD.raw, seriesFor: () => [F.cases.BBD.close] });
  const cl = buildClusters(served).byTicker.get('BBD');
  const rate = usdPerUnit('BRL', a.d, rates);
  assert.equal(cl.value, Math.round(a.s * a.p * rate) + Math.round(b.s * b.p * rate));
  assert.ok(cl.value < (a.s + b.s) * a.p * 0.25, 'about a fifth of the reais figure');
});

test('TSM: a dollar price per Taipei share ("translated from New Taiwan dollars") → per ADS (ratio 5, SEC 20-F)', () => {
  const i = sec('TSM');
  assert.match(i.quote, /five \(5\) common shares/);
  const { row } = F.cases.TSM;
  const n = run('TSM');
  assert.deepEqual([n.cu, n.ar, n.as], ['USD', 5, '20f']);
  assert.equal(n.p, Number((row.p * 5).toFixed(4)));
  assert.equal(n.s, Math.round(row.s / 5));
  assert.equal(n.v, Math.round(row.p * 5 * (row.s / 5)));
});

test('BABA: dollars per ordinary share → per ADS (ratio 8, SEC 20-F)', () => {
  const i = sec('BABA');
  assert.match(i.quote, /eight/i);
  const { row } = F.cases.BABA;
  const n = run('BABA');
  assert.deepEqual([n.cu, n.ar], ['USD', 8]);
  assert.equal(n.s, row.s / 8);
  assert.ok(Math.abs(n.p / F.cases.BABA.close.close - 1) < 0.1);
});

test('ASX: a Taipei sale in New Taiwan dollars → US dollars per ADS (ratio 2, SEC 20-F; H.10 rate)', () => {
  const i = sec('ASX');
  assert.match(i.quote, /two Common Shares/);
  const { row } = F.cases.ASX_sale;
  const n = run('ASX_sale');
  const rate = usdPerUnit('TWD', row.d, rates);
  assert.ok(rate > 0.02 && rate < 0.05, 'a TWD rate from H.10');
  assert.deepEqual([n.ok, n.cu, n.ar], [1, 'TWD', 2]);
  assert.equal(n.s, row.s / 2);
  assert.ok(Math.abs(n.p / F.cases.ASX_sale.close.close - 1) < 0.25);
});

test('ASX: an option exercise at a NT$ strike is not a market price — kept in TWD, out of totals', () => {
  const n = run('ASX');
  assert.deepEqual([n.fail, n.cu], ['non_market', 'TWD']);
  const [served] = normalizeRows([F.cases.ASX.row], { fpi: { issuers: { [F.cases.ASX.row.ci]: F.cases.ASX.issuer }, rates }, rawOf: () => F.cases.ASX.raw, seriesFor: () => [F.cases.ASX.close] });
  assert.equal(served.v, null);
  assert.equal(served.fx.lv, Math.round(F.cases.ASX.row.s * F.cases.ASX.row.p));
});

test('GGAL: dollars (converted from pesos) per Class B share → per ADS, ratio 10 derived from the closes', () => {
  const i = F.cases.GGAL.issuer;
  assert.equal(i.ratio, undefined, 'no SEC document states it');
  assert.deepEqual([i.der.ratio, i.der.agree, i.der.n], [10, 7, 7]);
  const n = run('GGAL');
  assert.deepEqual([n.cu, n.ar, n.as], ['USD', 10, 'derived']);
  assert.ok(Math.abs(n.p / F.cases.GGAL.close.close - 1) < 0.1);
});

test('VIPS: five ADSs per share (0.2, SEC 20-F) — not the 2 of its 2012 F-6', () => {
  const i = sec('VIPS');
  assert.equal(i.ratio, 0.2);
  const { row } = F.cases.VIPS;
  const n = run('VIPS');
  assert.deepEqual([n.cu, n.ar, n.s], ['USD', 0.2, Math.round(row.s / 0.2)]);
  assert.ok(Math.abs(n.p / F.cases.VIPS.close.close - 1) < 0.05);
});

test('DFDV: Series C preferred — "İmtiyazlı hisse alımı", no return from the common price', () => {
  const [served] = normalizeRows([F.cases.DFDV.row], { rawOf: () => F.cases.DFDV.raw });
  assert.equal(served.sk, 'preferred');
  assert.equal(categorize(served), 'preferred');
  assert.deepEqual(priceCheck(served, { current: 6.04 }), { ok: false, reason: 'security' });
});

test('NCT: a dollar price with no ADS — unchanged: amount kept, return hidden ("fiyat doğrulanamadı")', () => {
  assert.equal(run('NCT'), null);
  const r = { ...F.cases.NCT.row };
  assert.deepEqual(priceCheck(r, { series: null, current: 4.43 }).ok, false, 'no return (the nightly flag or the 2× rule)');
  delete r.pu;
  assert.deepEqual(priceCheck(r, { series: null, current: 4.43 }), { ok: false, reason: 'unverifiable' });
});
