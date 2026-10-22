// One row per trade: an amendment that repeats a report's lines adds nothing,
// but lines that look alike inside one report are separate trades (Hern's
// trusts, Salazar's two UBS accounts, Peters' two T-bills; 2026-10 sample).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexLegislators } from '../api/_lib/congressMembers.js';
import { buildServed } from '../api/_lib/congressModel.js';

const idx = indexLegislators([
  { id: { bioguide: 'H001082' }, name: { first: 'Kevin', last: 'Hern', official_full: 'Kevin Hern' }, terms: [{ type: 'rep', state: 'OK', district: 1, party: 'Republican', start: '2025-01-03', end: '2027-01-03' }] },
]);
const who = { ch: 'H', first: 'Kevin', last: 'Hern', stateDst: 'OK01', status: 'ok' };
const bsx = { d: '2026-09-03', t: 'BSX', a: 'Boston Scientific', at: 'stock', k: 'sell', o: 'dependent', lo: 1001, hi: 15000 };
const jenks = (y) => ({ d: '2026-09-03', t: null, a: `JENKS OKLA GO BDS 2.00% 11/01/${y}`, at: 'bond', k: 'buy', o: 'joint', lo: 15001, hi: 50000 });
const build = (filings) => buildServed(filings, { legislators: idx, since: '2025-01-01', now: Date.parse('2026-10-20') }).rows;

test('alike lines inside one report are all kept', () => {
  const rows = build({ 'H:1': { ...who, id: '1', filed: '2026-10-01', url: 'h1', tx: [bsx, bsx, bsx] } });
  assert.equal(rows.length, 3);
});

test('two bonds that differ only in maturity are two trades', () => {
  const rows = build({ 'H:1': { ...who, id: '1', filed: '2026-10-01', url: 'h1', tx: [jenks(2028), jenks(2030)] } });
  assert.deepEqual(rows.map((r) => r.a).sort(), [jenks(2028).a, jenks(2030).a]);
});

test('an amendment repeating the lines adds nothing; one more line than before adds one', () => {
  const orig = { ...who, id: '1', filed: '2026-10-01', url: 'h1', tx: [bsx, bsx] };
  assert.equal(build({ 'H:1': orig, 'H:2': { ...who, id: '2', filed: '2026-10-05', url: 'h2', tx: [bsx, bsx] } }).length, 2);
  assert.equal(build({ 'H:1': orig, 'H:2': { ...who, id: '2', filed: '2026-10-05', url: 'h2', tx: [bsx, bsx, bsx] } }).length, 3);
});
