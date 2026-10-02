// Every Form 4 line's dollar amount is checked against the market, foreign
// issuer or not. SLBT 2026-09-29: the aggregate price ($2,272,653) in the
// per-share field read $10.33T, took the home page's "ÖNE ÇIKAN" slot and
// made the day "Alımlar %100".
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeRows, aggregatePriceFix, amountGuard, usdValue } from '../api/_lib/fpiNormalize.js';
import { daySummary } from '../api/_lib/insiderModel.js';

const SLBT_RAW = {
  st: 'Ordinary Shares',
  fn: { F2: 'On September 29, 2026, SL Link Co., Ltd. sold and transferred 4,545,306 Ordinary Shares to Ching-Dong Wang for an aggregate purchase price of US$2,272,653 (the "Share Transfer").' },
};
const slbt = { t: 'SLBT', ci: '0002070534', n: 'Wang Ching-Dong', r: 'ceo', d: '2026-09-29', f: '2026-10-01', k: 'P', s: 4545306, p: 2272653, v: 10329903316818, a: '0001104659-26-112844', li: 0 };
const ctx = (extra = {}) => ({ fpi: { issuers: {}, rates: {} }, rawOf: () => null, seriesFor: () => null, meta: {}, ...extra });

test('SLBT: the aggregate price in the per-share field is read back per share', () => {
  const fixed = aggregatePriceFix(slbt, SLBT_RAW);
  assert.equal(fixed.p, 0.5);
  assert.equal(fixed.v, 2272653);
  assert.equal(fixed.fx.as, 'aggregate');
  assert.equal(fixed.fx.lv, 10329903316818);
  const [n] = normalizeRows([slbt], ctx({ rawOf: () => SLBT_RAW, seriesFor: () => [{ date: '2026-09-29', close: 1.6 }] }));
  assert.equal(n.v, 2272653);
  assert.equal(usdValue(n), 2272653);
  // no aggregate in the footnote: the price check and the size check stop it
  assert.equal(aggregatePriceFix(slbt, { fn: { F1: 'Represents 333,832,129 ordinary shares.' } }), null);
  const [g] = normalizeRows([slbt], ctx({ seriesFor: () => [{ date: '2026-09-29', close: 1.6 }] }));
  assert.equal(g.fx.fail, 'price_ratio');
  assert.equal(usdValue(g), null);
  assert.equal(g.fx.lv, 10329903316818);
});

test('a market trade more than 5× away from the close has no verified amount; an option exercise is left alone', () => {
  const series = [{ date: '2026-09-29', close: 10 }];
  const row = { t: 'ABC', d: '2026-09-29', k: 'P', s: 1000, p: 60, v: 60000 };
  assert.equal(amountGuard(row, { series }).fail, 'price_ratio');
  assert.equal(amountGuard({ ...row, p: 1.9, v: 1900 }, { series }).fail, 'price_ratio');
  assert.equal(amountGuard({ ...row, p: 45, v: 45000 }, { series }), null);
  assert.equal(amountGuard({ ...row, k: 'M', p: 0.5, v: 500 }, { series }), null);
  assert.equal(amountGuard({ ...row, k: 'S', p: 0.01, v: 10 }, { series }).fail, 'price_ratio');
});

test('$1B+ single lines: within the market cap they stand, above it (or $5B with no cap) they do not', () => {
  const at = (p, s) => ({ t: 'BIG', d: '2026-09-29', k: 'P', s, p, v: p * s });
  const series = [{ date: '2026-09-29', close: 100 }];
  assert.equal(amountGuard(at(100, 15e6), { series, meta: { mcap: 2e12 } }), null); // $1.5B in a $2T company
  assert.equal(amountGuard(at(100, 6e6), { series, meta: { mcap: 500e6 } }).fail, 'amount_cap'); // $600M > $500M cap
  assert.equal(amountGuard(at(100, 40e6), { series, meta: {} }), null); // $4B, no cap known
  assert.equal(amountGuard(at(100, 60e6), { series, meta: {} }).fail, 'amount_cap'); // $6B, no cap known
  // a stored cap of "$14" is a bad share count, not a company: the $5B line applies
  assert.equal(amountGuard(at(15, 1000), { series: [{ date: '2026-09-29', close: 15 }], meta: { mcap: 14 } }), null);
});

test('sentiment: a guarded line is out of the day\'s buy total and the split', () => {
  const day = '2026-10-01';
  const base = { d: '2026-09-30', f: day, a: 'x', li: 0, r: 'dir' };
  const rows = normalizeRows(
    [
      { ...slbt, f: day },
      { ...base, t: 'AAA', k: 'P', s: 1000, p: 10, v: 10000, a: 'a1' },
      { ...base, t: 'BBB', k: 'S', s: 3000, p: 10, v: 30000, a: 'a2' },
    ],
    ctx({ seriesFor: (t) => (t === 'SLBT' ? [{ date: '2026-09-29', close: 1.6 }] : [{ date: '2026-09-30', close: 10 }]) })
  );
  const s = daySummary(rows);
  assert.equal(s.buyValue, 10000);
  assert.equal(s.sellValue, 30000);
  assert.equal(s.sellShare, 75);
  assert.equal(s.fxExcluded, 1);
});

test('the committed home teaser: no amount above $5B, the day\'s buys not in the trillions', () => {
  const t = JSON.parse(fs.readFileSync(new URL('../client/public/insiders-teaser.json', import.meta.url), 'utf8'));
  assert.ok(t.pulse.buyValue < 1e11, `buyValue ${t.pulse.buyValue}`);
  assert.ok(!t.highlight || (t.highlight.v ?? 0) <= 5e9, `highlight ${t.highlight?.t} ${t.highlight?.v}`);
  for (const r of [...(t.rows || []), ...(t.signals?.csuite || []), ...(t.signals?.penny || [])]) assert.ok((r.v ?? 0) <= 5e9, `${r.t} ${r.v}`);
});
