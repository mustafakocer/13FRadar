// A fractional Form 4 line keeps its share count (SXI / Arets Max, 2026-08-21:
// 0.07 shares at $308.429 was stored as 0 shares).
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRow } from '../api/_lib/insiderForm4.js';

const s = { ticker: 'SXI', issuer: 'STANDEX INTERNATIONAL CORP', cik: '0000310354', filed: '2026-08-21' };
const o = { name: 'Arets Max', title: null, isDirector: true };
const row = (shares, owned) => makeRow({ s, o, code: 'A', d: '2026-08-21', shares, price: 308.429, owned, acc: '0000310354-26-000076', li: 1, formType: '4' });

test('fractional shares and shares-after keep four decimals', () => {
  const r = row(0.07, 1335.66);
  assert.equal(r.s, 0.07);
  assert.equal(r.o, 1335.66);
  assert.equal(r.v, 22);
});

test('whole share counts are unchanged', () => {
  const r = row(7500000, 24280714);
  assert.equal(r.s, 7500000);
  assert.equal(r.o, 24280714);
  assert.ok(Number.isInteger(r.s) && Number.isInteger(r.o));
});
