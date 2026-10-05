// D paketi, 2. PR: dönemsel getiri şeridi (/api/perf), fon tablosundaki
// "Bildirimden bu yana" sütunu ve kartlardaki izleme yıldızları.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ssr } from './helpers.mjs';
import { invoke } from '../api/_lib/ssr/invoke.js';
import perfHandler, { periodReturns } from '../api/_handlers/perf.js';

test('/api/perf/AAPL: seven periods, at least five of them filled', async () => {
  const r = await invoke(perfHandler, { ticker: 'AAPL' });
  assert.equal(r.status, 200);
  const keys = ['d1', 'w1', 'm1', 'm6', 'ytd', 'y1', 'y5'];
  assert.deepEqual(Object.keys(r.body.periods), keys);
  const filled = keys.filter((k) => Number.isFinite(r.body.periods[k]));
  assert.ok(filled.length >= 5, `filled: ${filled.join(',')}`);
  assert.equal((await invoke(perfHandler, { ticker: 'ZZZZZZ' })).status, 404);
});

test('periodReturns: short history leaves the long periods null', () => {
  const prices = [
    { date: '2026-09-01', close: 100 },
    { date: '2026-09-02', close: 110 },
  ];
  const p = periodReturns({ prices });
  assert.equal(p.periods.d1, 10);
  assert.equal(p.periods.y1, null);
  assert.equal(p.periods.y5, null);
  assert.equal(periodReturns({ prices: [] }), null);
});

test('Berkshire table: the "since reported" column is there', async () => {
  const { status, html } = await ssr('/tr/guru/berkshire-hathaway-warren-buffett');
  assert.equal(status, 200);
  assert.ok(html.includes('data-col="sinceReport"'), 'column rendered');
  assert.ok(html.includes('Bildirimden bu yana'), 'TR header');
});

test('watch stars on the home fund cards', async () => {
  const { status, html } = await ssr('/tr');
  assert.equal(status, 200);
  assert.ok(html.includes('fav-btn sm'), 'small star rendered on cards');
});

test('insider return column header says "Alımdan bu yana"', async () => {
  const fs = await import('node:fs');
  const i18n = fs.readFileSync(new URL('../client/src/i18n.jsx', import.meta.url), 'utf8');
  assert.match(i18n, /'ins\.returnCurr': 'Alımdan bu yana'/);
  assert.match(i18n, /'ins\.returnCurr': 'Since purchase'/);
});
