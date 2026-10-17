import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { parseCurrencyApi, extendSeries, staleRates, fallbackUrls } from '../api/_lib/fx.js';

test('currency-api: the day file read as USD per unit, only the currencies asked for', () => {
  const r = parseCurrencyApi({ date: '2026-10-15', usd: { twd: 32, lkr: 300, eur: 0.9 } }, ['TWD', 'LKR', 'XXX']);
  assert.deepEqual(r, { TWD: ['2026-10-15', 0.03125], LKR: ['2026-10-15', 0.00333333] });
  assert.deepEqual(parseCurrencyApi({ usd: { twd: 32 } }, ['TWD']), {}, 'no date, no rate');
  assert.deepEqual(parseCurrencyApi(null, ['TWD']), {});
  assert.match(fallbackUrls('2026-10-15')[0], /currency-api@2026-10-15\/v1\/currencies\/usd\.min\.json$/);
  assert.equal(fallbackUrls('2026-10-15').length, 2, 'a mirror when jsDelivr is down');
});

test('currency-api: extends the official series after its last day, weekdays only, never a jump', () => {
  const official = [['2026-09-24', 0.0315], ['2026-09-25', 0.0314]];
  const { series, added, refused } = extendSeries(official, [
    ['2026-09-25', 0.05], // the official day stays official
    ['2026-09-27', 0.0313], // Sunday
    ['2026-09-29', 0.0313],
    ['2026-09-28', 0.0312],
    ['2026-09-30', 0.04], // 27% off: refused
  ]);
  assert.deepEqual(series.slice(2), [['2026-09-28', 0.0312], ['2026-09-29', 0.0313]]);
  assert.equal(added, 2);
  assert.equal(refused, 1);
  assert.deepEqual(official.length, 2, 'the input is not changed');
  assert.equal(extendSeries([], [['2026-09-28', 1]]).added, 0, 'nothing to extend: no official rate to check against');
});

test('stale rates: older than 7 calendar days, oldest first', () => {
  const rates = { EUR: [['2026-10-16', 1.12]], TWD: [['2026-09-25', 0.031]], LKR: [['2026-10-09', 0.003]], JPY: [['2026-10-10', 0.0063]] };
  assert.deepEqual(staleRates(rates, '2026-10-17'), [{ cur: 'TWD', last: '2026-09-25', days: 22 }, { cur: 'LKR', last: '2026-10-09', days: 8 }]);
  assert.deepEqual(staleRates({ EUR: [] }, '2026-10-17'), [{ cur: 'EUR', last: null, days: Infinity }]);
  assert.deepEqual(staleRates(rates, '2026-10-17', { maxDays: 30 }), []);
});

test('the exchange-rate alarm: a dry run names the stale currencies', () => {
  const out = execFileSync('node', ['scripts/fx-stale-alarm.mjs', '--dry-run'], { cwd: new URL('..', import.meta.url).pathname, encoding: 'utf8', env: { ...process.env, FX_TODAY: '2099-01-01' } });
  assert.match(out, /^ALARM/);
  assert.match(out, /\| EUR \| \d{4}-\d{2}-\d{2} \| \d+ \|/);
});
