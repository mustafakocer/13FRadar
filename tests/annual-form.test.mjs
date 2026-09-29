// A company whose newest annual report is a 10-K is not a foreign private
// issuer, whatever 20-Fs sit further back in its history.
import test from 'node:test';
import assert from 'node:assert/strict';
import { annualStatus } from '../api/_lib/annualForm.js';

test('annualStatus: the newest annual report decides', () => {
  // Indivior: 20-F until 2024, 10-K since
  assert.equal(annualStatus([{ form: '20-F', date: '2024-03-15' }, { form: '10-K', date: '2026-02-26' }, { form: '6-K', date: '2025-06-01' }]).status, 'domestic');
  assert.equal(annualStatus([{ form: '10-K', date: '2019-03-01' }, { form: '20-F', date: '2026-04-20' }]).status, 'foreign');
  assert.equal(annualStatus([{ form: '40-F', date: '2026-03-20' }]).status, 'foreign');
  assert.equal(annualStatus([{ form: '10-KT', date: '2025-12-01' }]).status, 'domestic');
  // an amendment is not the annual report itself
  assert.equal(annualStatus([{ form: '20-F', date: '2025-04-01' }, { form: '10-K/A', date: '2026-01-10' }]).status, 'foreign');
  assert.equal(annualStatus([{ form: '6-K', date: '2026-01-10' }]).status, 'unclear');
});

test('normalizeRows: a company on the 10-K list keeps its Form 4 line as filed — dollars, one share per share', async () => {
  const { normalizeRows } = await import('../api/_lib/fpiNormalize.js');
  // INDV-like: an "Ordinary Shares" buy at the NYSE price; with an ADR ratio
  // of 5 on record the old rules divided 775 shares into 155 ADSs
  const row = { ci: '0001625297', t: 'INDV', d: '2026-01-05', k: 'P', s: 775, p: 35.39, v: Math.round(775 * 35.39), a: '0001-26-000001', li: 0 };
  const issuer = { t: 'INDV', fpi: 1, cur: 'GBP', ads: 1, ratio: 5, src: 'f6', lf: '2024-03-15', v: 4 };
  const raw = { st: 'Ordinary Shares', fn: {} };
  const ctx = (tenK) => ({ fpi: { issuers: { [row.ci]: issuer }, rates: { GBP: [['2026-01-05', 1.27]] }, ...(tenK ? { tenK: { [row.ci]: '2026-02-26' } } : {}) }, rawOf: () => raw, seriesFor: () => [{ date: '2026-01-05', close: 35.4 }] });
  const [asFiled] = normalizeRows([row], ctx(true));
  assert.equal(asFiled.s, 775, 'no ADS division');
  assert.equal(asFiled.p, 35.39);
  assert.equal(asFiled.fx?.ar ?? 1, 1);
  // without the 10-K mark the old ratio would apply
  const [old] = normalizeRows([row], ctx(false));
  assert.equal(old.s, 155);
});

test('normalizeRows: a 10-K company\'s line the filing states in Canadian dollars is still converted', async () => {
  const { normalizeRows } = await import('../api/_lib/fpiNormalize.js');
  const row = { ci: '0001737927', t: 'CGC', d: '2026-08-24', k: 'S', s: 2231, p: 1.47, v: Math.round(2231 * 1.47), a: '0002-26-000001', li: 0 };
  // the footnote on the real filing (0001104659-26-100924)
  const raw = { st: 'Common Shares', fn: { F2: 'Price expressed in Canadian dollars, rounded to the nearest one hundredth.' } };
  const fpi = { issuers: {}, rates: { CAD: [['2026-08-21', 0.7225], ['2026-08-24', 0.7225]] }, tenK: { [row.ci]: '2026-06-15' } };
  const [n] = normalizeRows([row], { fpi, rawOf: () => raw, seriesFor: () => [{ date: '2026-08-24', close: 1.06 }] });
  assert.equal(n.fx?.cu, 'CAD');
  assert.ok(Math.abs(n.p - 1.47 * 0.7225) < 0.01, `price ${n.p}`);
});

test('normalizeRows: a 10-K company\'s line keeps the market check — far from the close or unverifiable, no dollar amount', async () => {
  const { normalizeRows, usdValue } = await import('../api/_lib/fpiNormalize.js');
  const ci = '0001858685';
  const issuer = { t: 'MYNZ', fpi: 1, cur: 'EUR', ads: 1, ratio: 0.25, src: 'f6', lf: '2024-04-30', v: 4 };
  const raw = { st: 'Ordinary Shares', fn: {} };
  const fpi = { issuers: { [ci]: issuer }, rates: { EUR: [['2025-10-17', 1.17]] }, tenK: { [ci]: '2026-03-01' } };
  // Mynaric-like: 643,850 shares "at" 402,000 with no price data — the old
  // check could not verify it, and neither can the US one: no $258.8B line
  const garbled = { ci, t: 'MYNZ', d: '2025-10-17', k: 'P', s: 643850, p: 402000, v: 643850 * 402000, a: '0003-25-000001', li: 0 };
  const [g] = normalizeRows([garbled], { fpi, rawOf: () => raw, seriesFor: () => null });
  assert.equal(g.fx?.fail, 'unverifiable');
  assert.equal(usdValue(g), null);
  // with a close: 3× the close is a unit problem, not a price
  const far = { ...garbled, s: 1000, p: 30, v: 30000 };
  const [f] = normalizeRows([far], { fpi, rawOf: () => raw, seriesFor: () => [{ date: '2025-10-17', close: 10 }] });
  assert.equal(f.fx?.fail, 'mismatch');
  assert.equal(usdValue(f), null);
  // 30% under the close: off-market, amount shown, out of totals
  const [o] = normalizeRows([{ ...far, p: 7 }], { fpi, rawOf: () => raw, seriesFor: () => [{ date: '2025-10-17', close: 10 }] });
  assert.equal(o.fx?.off, -30);
  assert.equal(o.s, 1000);
  // an option exercise at the strike: no market amount
  const [m] = normalizeRows([{ ...far, k: 'M', p: 2 }], { fpi, rawOf: () => raw, seriesFor: () => [{ date: '2025-10-17', close: 10 }] });
  assert.equal(m.fx?.fail, 'non_market');
  // at the close: as filed, no ratio (the old rules would read 0.25)
  const [ok] = normalizeRows([{ ...far, p: 10.1, v: 10100 }], { fpi, rawOf: () => raw, seriesFor: () => [{ date: '2025-10-17', close: 10 }] });
  assert.equal(ok.s, 1000);
  assert.equal(ok.v, 10100);
  assert.equal(ok.fx, undefined);
});

test('normalizeRows: a 10-K company\'s line the foreign rules never touched is left exactly as it was', async () => {
  const { normalizeRows } = await import('../api/_lib/fpiNormalize.js');
  // no issuer on record: an option exercise at the strike keeps its amount
  const row = { ci: '0001611046', t: 'QURE', d: '2026-06-30', k: 'M', s: 4107, p: 37, v: 151959, a: '0004-26-000001', li: 0 };
  const [n] = normalizeRows([row], { fpi: { issuers: {}, rates: {}, tenK: { [row.ci]: '2026-02-27' } }, rawOf: () => ({ st: 'Ordinary Shares', fn: {} }), seriesFor: () => [{ date: '2026-06-30', close: 12 }] });
  assert.equal(n, row);
});
