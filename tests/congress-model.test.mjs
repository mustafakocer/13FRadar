import { test } from 'node:test';
import assert from 'node:assert/strict';
import { committeeSeats, filerName, indexLegislators, matchHouse, matchSenate, normName } from '../api/_lib/congressMembers.js';
import { buildServed, feed, memberView, overview, rowReturn, tickerView } from '../api/_lib/congressModel.js';

const LEG = [
  { id: { bioguide: 'W000816' }, name: { first: 'Roger', last: 'Williams', official_full: 'Roger Williams' }, terms: [{ type: 'rep', state: 'TX', district: 25, party: 'Republican', start: '2023-01-03', end: '2027-01-03' }] },
  { id: { bioguide: 'W000999' }, name: { first: 'Nikema', last: 'Williams', official_full: 'Nikema Williams' }, terms: [{ type: 'rep', state: 'GA', district: 5, party: 'Democrat', start: '2023-01-03', end: '2027-01-03' }] },
  { id: { bioguide: 'M000355' }, name: { first: 'Mitch', last: 'McConnell', official_full: 'Mitch McConnell' }, terms: [{ type: 'sen', state: 'KY', party: 'Republican', start: '2021-01-03', end: '2027-01-03' }] },
  { id: { bioguide: 'J000312' }, name: { first: 'Jim', middle: 'Conley', last: 'Justice', suffix: 'II', official_full: 'James C. Justice, II' }, terms: [{ type: 'sen', state: 'WV', party: 'Republican', start: '2025-01-03', end: '2031-01-03' }] },
  { id: { bioguide: 'S000001' }, name: { first: 'Rick', last: 'Scott', official_full: 'Rick Scott' }, terms: [{ type: 'sen', state: 'FL', party: 'Republican', start: '2019-01-03', end: '2031-01-03' }] },
  { id: { bioguide: 'S000002' }, name: { first: 'Tim', last: 'Scott', official_full: 'Tim Scott' }, terms: [{ type: 'sen', state: 'SC', party: 'Republican', start: '2023-01-03', end: '2029-01-03' }] },
];
const idx = indexLegislators(LEG);

test('names normalise without suffixes, accents or punctuation', () => {
  assert.equal(normName('McConnell, Jr.'), 'mcconnell');
  assert.equal(normName('Justice, II'), 'justice');
  assert.equal(normName('Velázquez'), 'velazquez');
  assert.equal(filerName('Hon. Rudy C.', 'Yakym III'), 'Rudy C. Yakym III');
});

test('House filers match on seat and last name', () => {
  assert.equal(matchHouse(idx, { first: 'Roger', last: 'Williams', stateDst: 'TX25' }, '2026-01-05').bioguide, 'W000816');
  assert.equal(matchHouse(idx, { first: 'Nikema', last: 'Williams', stateDst: 'GA05' }, '2026-01-05').bioguide, 'W000999');
  assert.equal(matchHouse(idx, { first: 'Nobody', last: 'Else', stateDst: 'CA12' }, '2026-01-05'), null);
});

test('Senate filers match on last name, first names break ties', () => {
  assert.equal(matchSenate(idx, { first: 'A. Mitchell', last: 'McConnell, Jr.' }, '2026-02-01').bioguide, 'M000355');
  assert.equal(matchSenate(idx, { first: 'James Conley', last: 'Justice, II' }, '2026-02-01').bioguide, 'J000312');
  assert.equal(matchSenate(idx, { first: 'Rick', last: 'Scott' }, '2026-02-01').bioguide, 'S000001');
  assert.equal(matchSenate(idx, { first: 'Timothy', last: 'Scott' }, '2026-02-01').bioguide, 'S000002');
});

test('committee seats skip subcommittees', () => {
  const { seats, names } = committeeSeats([{ thomas_id: 'SSAF', name: 'Committee on Agriculture' }], { SSAF: [{ bioguide: 'M000355' }], SSAF13: [{ bioguide: 'J000312' }] });
  assert.deepEqual(seats, { M000355: ['SSAF'] });
  assert.equal(names.SSAF, 'Committee on Agriculture');
});

const SERIES = { CVX: [{ date: '2025-12-22', close: 150 }, { date: '2026-10-07', close: 165 }], JPM: [{ date: '2026-01-02', close: 200 }, { date: '2026-10-07', close: 180 }] };
const FILINGS = {
  'H:1': { ch: 'H', id: '1', filed: '2026-01-10', first: 'Roger', last: 'Williams', stateDst: 'TX25', url: 'h1', status: 'ok', tx: [
    { d: '2025-12-22', t: 'CVX', a: 'Chevron', at: 'stock', k: 'buy', o: 'self', lo: 15001, hi: 50000 },
    { d: '2026-01-02', t: 'JPM', a: 'JPMorgan', at: 'stock', k: 'sell', o: 'spouse', lo: 1001, hi: 15000 },
  ] },
  // an amendment repeating the first line
  'H:2': { ch: 'H', id: '2', filed: '2026-01-20', first: 'Roger', last: 'Williams', stateDst: 'TX25', url: 'h2', status: 'ok', tx: [
    { d: '2025-12-22', t: 'CVX', a: 'Chevron', at: 'stock', k: 'buy', o: 'self', lo: 15001, hi: 50000 },
  ] },
  'S:a': { ch: 'S', id: 'a', filed: '2026-02-01', first: 'A. Mitchell', last: 'McConnell, Jr.', url: 's1', status: 'ok', tx: [
    { d: '2026-01-02', t: 'JPM', a: 'JPMorgan', at: 'stock', k: 'buy', o: 'joint', lo: 1000001, hi: 5000000 },
  ] },
  'S:b': { ch: 'S', id: 'b', filed: '2026-02-01', first: 'X', last: 'Unknown', url: 's2', status: 'ok', tx: [
    { d: '2026-01-05', t: null, a: 'US Treasury Bill', at: 'bond', k: 'buy', o: 'self', lo: 50001, hi: 100000 },
  ] },
  'H:old': { ch: 'H', id: 'old', filed: '2024-06-01', first: 'Roger', last: 'Williams', stateDst: 'TX25', url: 'h0', status: 'ok', tx: [{ d: '2024-05-01', t: 'CVX', a: 'Chevron', at: 'stock', k: 'buy', o: 'self', lo: 1001, hi: 15000 }] },
  'H:scan': { ch: 'H', id: 'scan', filed: '2026-03-01', first: 'A', last: 'B', stateDst: 'CA01', url: 'h3', status: 'scan', tx: [] },
};
const seriesFor = (t) => (SERIES[t] ? { prices: SERIES[t] } : null);
const served = buildServed(FILINGS, { legislators: idx, seats: { M000355: ['SSAF'] }, committeeNames: { SSAF: 'Committee on Agriculture' }, seriesFor, since: '2025-01-01', now: Date.parse('2026-10-08') });
const db = { ...served, bySlug: Object.fromEntries(Object.entries(served.members).map(([k, m]) => [m.slug, k])) };

test('the served file: matched members, one row per trade, prices on the trade day', () => {
  assert.equal(served.counts.rows, 4);
  assert.equal(served.members.W000816.p, 'R');
  assert.equal(served.members.W000816.slug, 'roger-williams');
  assert.deepEqual(served.members.M000355.cm, ['SSAF']);
  assert.equal(served.members['S:x-unknown'].p, null);
  assert.deepEqual(served.unmatched, ['S X Unknown']);
  const cvx = served.rows.find((r) => r.t === 'CVX');
  assert.equal(cvx.pt, 150);
  assert.equal(served.px.CVX.c, 165);
  assert.ok(Math.abs(rowReturn(cvx, served.px) - 0.1) < 1e-9);
  assert.equal(served.rows[0].f, '2026-02-01');
});

test('views', () => {
  const o = overview(db, { days: 400, now: Date.parse('2026-10-08') });
  assert.equal(o.recentCount, 4);
  assert.equal(o.topBought[0].t, 'JPM');
  assert.equal(o.largest[0].n, 'Mitch McConnell');
  assert.equal(o.party.R, 3);
  assert.equal(feed(db, { kind: 'sell' }).total, 1);
  assert.equal(feed(db, { ch: 'S' }).total, 2);
  assert.equal(feed(db, { q: 'treasury' }).total, 1);
  assert.equal(feed(db, { member: 'nobody' }).total, 0);
  const m = memberView(db, 'roger-williams');
  assert.equal(m.member.trades, 2);
  assert.equal(m.member.buys, 1);
  assert.ok(Math.abs(m.member.avgBuyRet - 0.1) < 1e-9);
  assert.equal(memberView(db, 'nobody'), null);
  const t = tickerView(db, 'jpm');
  assert.equal(t.total, 2);
  assert.equal(t.members, 2);
});

test('a stock filed without a ticker gets the one written in its name', async () => {
  const { tickerFromName } = await import('../api/_lib/congressModel.js');
  assert.equal(tickerFromName('Electronic Arts Inc. (EA)'), 'EA');
  assert.equal(tickerFromName('EA - Electronic Arts Inc'), 'EA');
  assert.equal(tickerFromName('SDZNY- Sandoz Group AG ADR'), 'SDZNY');
  assert.equal(tickerFromName('GS Managed Structured Note Strategy S&P 500 Linked Note'), null);
});

test('a trade dated years before its report is a typo and is dropped', () => {
  const out = buildServed({ 'H:x': { ch: 'H', id: 'x', filed: '2025-06-01', first: 'Roger', last: 'Williams', stateDst: 'TX25', url: 'u', status: 'ok', tx: [{ d: '2015-05-08', t: 'CVX', a: 'Chevron', at: 'stock', k: 'buy', o: 'self', lo: 1001, hi: 15000 }, { d: '2025-05-08', t: 'CVX', a: 'Chevron', at: 'stock', k: 'buy', o: 'self', lo: 1001, hi: 15000 }] } }, { legislators: idx, since: '2025-01-01' });
  assert.equal(out.rows.length, 1);
  assert.equal(out.rows[0].d, '2025-05-08');
});

test('committees: the members who sit on one, their trades, the index', async () => {
  const { committeeIndex, committeeView } = await import('../api/_lib/congressModel.js');
  const idx2 = committeeIndex(db);
  assert.deepEqual(idx2.map((c) => [c.slug, c.ch, c.members, c.trades]), [['committee-on-agriculture', 'S', 1, 1]]);
  const v = committeeView(db, 'committee-on-agriculture');
  assert.equal(v.members[0].n, 'Mitch McConnell');
  assert.equal(v.topBought[0].t, 'JPM');
  assert.equal(v.rows.length, 1);
  assert.equal(committeeView(db, 'no-such-committee'), null);
});

test('committee field: an industry code inside a seat the member holds flags the trade', async () => {
  const { jurisdictionLabel, matchingCommittees } = await import('../api/_lib/congressJurisdiction.js');
  assert.equal(jurisdictionLabel('HSAS', '3721'), 'aircraft & parts');
  assert.equal(jurisdictionLabel('HSAS', '6022'), null);
  assert.equal(jurisdictionLabel('HSBA', 6022), 'banks, lenders & brokers');
  assert.equal(jurisdictionLabel('HSAP', '3721'), null, 'appropriations covers everything, so it flags nothing');
  assert.deepEqual(matchingCommittees(['SSAF', 'HSBA'], '6211'), ['SSAF', 'HSBA'], 'brokers: CFTC markets and securities');
  assert.deepEqual(matchingCommittees(['SSAF'], null), []);

  const sicFor = (t) => ({ JPM: '6021', CVX: '2911' })[t] || null;
  const out = buildServed(FILINGS, { legislators: idx, seats: { M000355: ['SSBK'] }, committeeNames: { SSBK: 'Senate Committee on Banking' }, seriesFor, sicFor, since: '2025-01-01' });
  const jpm = out.rows.find((r) => r.m === 'M000355' && r.t === 'JPM');
  assert.deepEqual(jpm.jx, ['SSBK']);
  assert.equal(out.rows.filter((r) => r.jx).length, 1, 'Williams sits on no committee here, so his JPM sale is not flagged');
  assert.equal(out.counts.inField, 1);
  const d2 = { ...out, bySlug: Object.fromEntries(Object.entries(out.members).map(([k, m]) => [m.slug, k])) };
  assert.equal(feed(d2, { field: true }).total, 1);
  const shown = feed(d2, { field: true }).rows[0];
  assert.deepEqual(shown.field, [{ id: 'SSBK', name: 'Senate Committee on Banking', slug: 'senate-committee-on-banking', label: 'banks, lenders & brokers' }]);
  assert.equal(overview(d2, { days: 400, now: Date.parse('2026-10-08') }).inFieldCount, 1);
});

test('a health insurer is in the health committees field, not banking', async () => {
  const { jurisdictionLabel } = await import('../api/_lib/congressJurisdiction.js');
  assert.equal(jurisdictionLabel('HSBA', '6324'), null);
  assert.equal(jurisdictionLabel('SSHR', '6324'), 'health insurance');
  assert.equal(jurisdictionLabel('HSBA', '6331'), 'insurance');
});
