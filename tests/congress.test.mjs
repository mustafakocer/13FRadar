import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAmount, bandIndex, normalizeType, isoDate, cleanTicker, legislatorIndex, matchLegislator, normalizeHouse, normalizeSenate, mergeCongress } from '../api/_lib/congress.js';

test('parseAmount / bandIndex', () => {
  assert.deepEqual(parseAmount('$1,001 - $15,000'), { min: 1001, max: 15000, band: '$1K – $15K' });
  assert.deepEqual(parseAmount('$1,000,001 - $5,000,000'), { min: 1000001, max: 5000000, band: '$1M – $5M' });
  assert.deepEqual(parseAmount('Over $50,000,000'), { min: 50000000, max: null, band: '$50M+' });
  assert.equal(parseAmount('').min, null);
  assert.equal(bandIndex(1001), 0);
  assert.equal(bandIndex(250001), 4);
  assert.equal(bandIndex(null), -1);
});

test('normalizeType / isoDate / cleanTicker', () => {
  assert.equal(normalizeType('purchase'), 'buy');
  assert.equal(normalizeType('Sale (Partial)'), 'sell');
  assert.equal(normalizeType('sale_full'), 'sell');
  assert.equal(normalizeType('Exchange'), 'exchange');
  assert.equal(isoDate('2026-08-14'), '2026-08-14');
  assert.equal(isoDate('08/14/2026'), '2026-08-14');
  assert.equal(isoDate('nonsense'), null);
  assert.equal(cleanTicker('--'), null);
  assert.equal(cleanTicker(' brk.b '), 'BRK.B');
});

const legislators = [
  { name: { first: 'Nancy', last: 'Pelosi', official_full: 'Nancy Pelosi' }, terms: [{ type: 'rep', party: 'Democrat', state: 'CA', district: 11, end: '2027-01-03' }] },
  { name: { first: 'Tommy', last: 'Tuberville', official_full: 'Tommy Tuberville' }, terms: [{ type: 'sen', party: 'Republican', state: 'AL', end: '2027-01-03' }] },
  { name: { first: 'Bernard', last: 'Sanders', official_full: 'Bernard Sanders' }, terms: [{ type: 'sen', party: 'Independent', state: 'VT', end: '2031-01-03' }] },
];
const idx = legislatorIndex(legislators);

test('matchLegislator: full, "Last, First", honorific + middle, unique last name', () => {
  assert.equal(matchLegislator(idx, 'house', 'Nancy Pelosi').party, 'D');
  assert.equal(matchLegislator(idx, 'house', 'Pelosi, Nancy').district, '11');
  assert.equal(matchLegislator(idx, 'senate', 'Hon. Thomas H. Tuberville').party, 'R', 'unique last name');
  assert.equal(matchLegislator(idx, 'senate', 'Bernie Sanders').party, 'I');
  assert.equal(matchLegislator(idx, 'house', 'Tommy Tuberville'), null, 'wrong chamber');
});

test('normalizeHouse / normalizeSenate / mergeCongress', () => {
  const h = normalizeHouse({ transaction_date: '2026-08-01', disclosure_date: '08/20/2026', owner: 'joint', ticker: 'NVDA', asset_description: 'NVIDIA Corp', type: 'purchase', amount: '$1,000,001 - $5,000,000', representative: 'Hon. Nancy Pelosi', district: 'CA11', ptr_link: 'https://x' }, idx);
  assert.equal(h.chamber, 'house');
  assert.equal(h.party, 'D');
  assert.equal(h.type, 'buy');
  assert.equal(h.amountMin, 1000001);
  assert.equal(h.disclosureDate, '2026-08-20');
  const s = normalizeSenate({ transaction_date: '07/15/2026', senator: 'Thomas H Tuberville', ticker: '--', asset_description: 'US Treasury bill', type: 'Sale (Full)', amount: '$15,001 - $50,000' }, idx);
  assert.equal(s.ticker, null);
  assert.equal(s.type, 'sell');
  assert.equal(s.state, 'AL');
  assert.equal(normalizeHouse({ transaction_date: 'bad' }, idx), null);
  const rows = mergeCongress([h, s, h, { ...s, id: 'old', transactionDate: '2024-01-01' }], { now: '2026-09-03' });
  assert.deepEqual(rows.map((r) => r.chamber), ['house', 'senate']);
});
