import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isAdsTitle, adsVotes, isAdsListing, resolveAdrRatio, withoutPerShare, adrResolver } from '../api/_lib/adrResolve.js';
import { valuationFor } from '../api/_lib/secFundamentals.js';

test('isAdsTitle: depositary titles, not LP units or NY registry shares', () => {
  for (const s of ['SPONSORED ADR', 'SPON ADS CL A', 'ADR', 'ADS', 'SPONSORD ADS', 'EQUITY DEPOSITARY RECEIPTS']) assert.equal(isAdsTitle(s), true, s);
  for (const s of ['COM', 'ORD SHS', 'DEPOSITARY UNIT', 'N Y REGISTRY SHS', 'CL A', '']) assert.equal(isAdsTitle(s), false, s);
});

test('adsVotes / isAdsListing: the majority of 13F titles decides, a stray "ADR" does not', () => {
  const lh = { byCik: {
    a: { top: [{ cusip: 'H', class: 'SPON ADR NEW' }, { cusip: 'F', class: 'COM' }] },
    b: { top: [{ cusip: 'H', class: 'ADR' }, { cusip: 'F', class: 'COM' }] },
    c: { top: [{ cusip: 'F', class: 'ADR' }, { cusip: 'H', class: 'SPON ADR', putCall: 'Put' }] },
  } };
  const v = adsVotes(lh, (c) => ({ H: 'HSBC', F: 'FIX' })[c]);
  assert.deepEqual(v.get('HSBC'), { ads: 2, total: 2 });
  assert.equal(isAdsListing({ votes: v.get('HSBC') }), true);
  assert.equal(isAdsListing({ votes: v.get('FIX') }), false, 'two COM, one stray ADR');
  assert.equal(isAdsListing({ issuer: { ads: 0 }, votes: v.get('HSBC') }), false, "fpi.json's answer wins");
});

test('resolveAdrRatio: force > documented > reviewed; an ADS with none is unknown, never 1', () => {
  assert.deepEqual(resolveAdrRatio({ override: { ratio: 1, force: true }, issuer: { ads: 1, ratio: 0.5 } }), { ratio: 1, unknown: false });
  assert.deepEqual(resolveAdrRatio({ override: { ratio: 9 }, issuer: { ads: 1, ratio: 5 } }), { ratio: 5, unknown: false });
  assert.deepEqual(resolveAdrRatio({ override: { ratio: 5 }, issuer: { ads: 1 } }), { ratio: 5, unknown: false });
  assert.deepEqual(resolveAdrRatio({ issuer: { ads: 1 } }), { ratio: null, unknown: true });
  assert.deepEqual(resolveAdrRatio({ votes: { ads: 3, total: 3 } }), { ratio: null, unknown: true });
  assert.deepEqual(resolveAdrRatio({ issuer: { ads: 0 } }), { ratio: null, unknown: false });
});

test('withoutPerShare: no P/E, no market cap, no yield; beta stays', () => {
  const rec = { cik: '1', eps: { value: 1.2, url: 'u', form: '20-F' }, div: { value: 0.5 }, shares: { value: 17e9 }, beta: { value: 1 } };
  const out = withoutPerShare(rec);
  const v = valuationFor(out, 96);
  assert.deepEqual([v.pe, v.marketCap, v.dividendYield], [null, null, null]);
  assert.equal(out.beta.value, 1);
  assert.match(out.eps.reason, /ADS/);
});

test('repository data: the reviewed ratios are applied and every known ADS has a ratio or is withheld', () => {
  const adrOf = adrResolver(process.cwd());
  assert.deepEqual(adrOf('HSBC', '0001089113'), { ratio: 5, unknown: false });
  assert.deepEqual(adrOf('AZN', '0000901832'), { ratio: 1, unknown: false }, 'ADS programme ended 2026-01-30');
  assert.deepEqual(adrOf('TSM', '0001046179'), { ratio: 5, unknown: false });
  const F = JSON.parse(fs.readFileSync('api/_data/fundamentals.json', 'utf8')).byTicker;
  const meta = JSON.parse(fs.readFileSync('api/_data/ticker-meta.json', 'utf8'));
  const pe = (t) => meta[t].px / F[t].eps.value;
  assert.ok(pe('HSBC') > 8 && pe('HSBC') < 30, `HSBC P/E ${pe('HSBC')}`);
  assert.ok(pe('AZN') > 12 && pe('AZN') < 40, `AZN P/E ${pe('AZN')}`);
  // no stock page shows a market cap of a trillion-plus for an ADS (TSM aside)
  for (const [t, m] of Object.entries(meta)) if (m.mcap > 1.5e12) assert.ok(['TSM', 'AAPL', 'MSFT', 'NVDA', 'GOOGL', 'GOOG', 'AMZN', 'META', 'AVGO', 'BRK.B', 'BRK-B', 'BRK.A', 'BRK-A', 'TSLA', 'LLY', 'WMT', 'JPM', 'ORCL', 'V'].includes(t), `${t} mcap ${m.mcap}`);
});
