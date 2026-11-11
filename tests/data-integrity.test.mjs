// Five wrong numbers found on the live site in November 2026, each with the
// record that showed it. (The sixth, a share split inside a price series, is
// in prices-split.test.mjs.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { screenerCap } from '../api/_lib/stockMetaBuild.js';
import { capBucket } from '../api/_lib/stockMeta.js';
import { sharesOutstanding } from '../api/_lib/secFundamentals.js';
import { makeRow, applyDirection, ownershipChange } from '../api/_lib/insiderForm4.js';
import { classify, isDisposal, directionBox, sideOf } from '../api/_lib/insiderClassify.js';
import { forwardExcess, lateBaseExcess, annotateOutcomes } from '../api/_lib/insiderOutcome.js';
import { parseAmount, amountMid, backwardsAmount } from '../api/_lib/congressParse.js';
import { auditDataset, DATASETS } from '../api/_lib/dataAudit.js';

// ---------------------------------------------------------------- market cap

test('ONC: the screener prices the count per ADS, as the stock page does — $47.7B and "large", not $619.7B and "mega"', () => {
  const price = 417.33;
  // fundamentals.json: 1,484,939,027 ordinary shares ÷ 13 per ADS
  const rec = { shares: { value: 114226079, perAds: 13 } };
  const cap = screenerCap({ price, rec, frameShares: 1484939027, adr: { ratio: 13, unknown: false } });
  assert.deepEqual(cap, { v: Math.round(114226079 * price), src: 'fundamentals' });
  assert.equal(Math.round(cap.v / 1e8), 477, '$47.7B');
  assert.equal(capBucket(cap.v), 'large');
  assert.equal(capBucket(Math.round(1484939027 * price)), 'mega', 'what the raw cover count gave');
});

test('screenerCap: no record → the frames through the ADR ratio; an ADS of unknown ratio or a refused count → no cap; no price → nothing to say', () => {
  assert.deepEqual(screenerCap({ price: 10, frameShares: 1000, adr: { ratio: 4, unknown: false } }), { v: 2500, src: 'sec' });
  assert.deepEqual(screenerCap({ price: 10, frameShares: 1000, adr: { ratio: null, unknown: false } }), { v: 10000, src: 'sec' });
  assert.equal(screenerCap({ price: 10, frameShares: 1000, adr: { ratio: null, unknown: true } }), null);
  assert.equal(screenerCap({ price: 10, rec: { shares: null }, frameShares: 1000 }), null, 'the fundamentals build refused the count: the frames are not a second opinion');
  assert.equal(screenerCap({ price: 10, frameShares: null, adr: null }), undefined, 'no count tonight: the cap on file stays');
  assert.equal(screenerCap({ price: null, rec: { shares: { value: 5 } } }), undefined);
});

// Shift4 (CIK 1794669) as companyfacts states it: EPS and the Class A/B
// averages are tagged per class and dropped, so the only weighted count left
// is Class C's, and there is no EPS to referee.
const FOUR = {
  dei: { EntityCommonStockSharesOutstanding: { units: { shares: [
    { end: '2026-07-31', val: 78960120, accn: 'q2', filed: '2026-08-05', form: '10-Q' },
    { end: '2026-10-31', val: 74943944, accn: 'q3', filed: '2026-11-05', form: '10-Q' },
  ] } } },
  'us-gaap': {
    WeightedAverageNumberOfDilutedSharesOutstanding: { units: { shares: [
      { start: '2024-01-01', end: '2024-12-31', val: 1668826, accn: 'k24', filed: '2025-02-20', form: '10-K', fy: 2024, fp: 'FY' },
      { start: '2025-01-01', end: '2025-12-31', val: 1333686, accn: 'k25', filed: '2026-02-27', form: '10-K', fy: 2025, fp: 'FY' },
    ] } },
  },
};

test('FOUR: a cover count far above the only weighted average on file, and newer, is the company — 74.9M shares, not Class C\'s 1.3M', () => {
  const sh = sharesOutstanding(FOUR, null, { asOf: '2026-11-10' });
  assert.equal(sh.value, 74943944);
  assert.equal(sh.basis, undefined, 'the cover count');
  assert.equal(Math.round((sh.value * 45.01) / 1e6), 3373, '$3.37B at $45.01 — it read $60M');
});

test('a cover count far BELOW the weighted average stays suspect: the average is used (one class of several, a tenth of the ordinary shares)', () => {
  const facts = {
    dei: { EntityCommonStockSharesOutstanding: { units: { shares: [{ end: '2026-10-31', val: 10_000_000, accn: 'q3', filed: '2026-11-05', form: '10-Q' }] } } },
    'us-gaap': { WeightedAverageNumberOfDilutedSharesOutstanding: { units: { shares: [{ start: '2026-07-01', end: '2026-09-30', val: 90_000_000, accn: 'q3', filed: '2026-11-05', form: '10-Q', fy: 2026, fp: 'Q3' }] } } },
  };
  const sh = sharesOutstanding(facts, null, { asOf: '2026-11-10' });
  assert.equal(sh.value, 90_000_000);
  assert.equal(sh.basis, 'weighted-average');
});

// ---------------------------------------------------------- insider direction

const S = { ticker: 'WM', issuer: 'Waste Management', cik: '0000823768', filed: '2026-11-05' };
const O = { name: 'Reed David L.', title: 'EVP & CFO', isOfficer: true };
const gift = (li, owned, ad) => makeRow({ s: S, o: O, code: 'G', ad, d: '2026-11-04', shares: 531, price: 0, owned, acc: '0001225208-26-008729', li, formType: '4' });

test('WM: a gift is given or received — the form\'s A/D box says which', () => {
  const given = gift(0, 2373, 'D');
  const received = gift(1, 5888.168, 'A');
  assert.equal(given.oc, -18.3);
  assert.equal(given.ad, undefined, 'the box agrees with the code: no extra field');
  assert.equal(classify(given).side, 'sell');
  assert.equal(received.oc, 9.9, '531 shares into an account that held 5,357 — it read −8.3%');
  assert.equal(received.ad, 'A');
  assert.equal(classify(received).side, 'buy');
  assert.equal(classify(received).category, 'gift');
});

test('direction: P and S by the code (a box that disagrees is the slip), every other code by the box, the code\'s usual side without one', () => {
  assert.equal(isDisposal('P', 'D'), false, "Forager's RPAY purchases, ticked D");
  assert.equal(isDisposal('S', 'A'), true);
  assert.equal(directionBox('P', 'D'), null);
  assert.equal(isDisposal('J', 'D'), true);
  assert.equal(isDisposal('J', null), false);
  assert.equal(isDisposal('C', 'D'), true, 'the class given up in a conversion');
  assert.equal(isDisposal('F', ''), true);
  assert.equal(isDisposal('G', undefined), true);
  assert.equal(directionBox('J', 'D'), 'D');
  assert.equal(directionBox('J', 'A'), null);
  assert.equal(directionBox('F', 'a'), 'A');
  // the tabs without a box are what they were
  assert.equal(sideOf({ k: 'F', p: 10 }), 'sell');
  assert.equal(sideOf({ k: 'A', p: 0 }), 'buy');
  assert.equal(sideOf({ k: 'D', p: 5 }), 'sell');
  assert.equal(sideOf({ k: 'J', p: 0 }), 'buy');
  assert.equal(sideOf({ k: 'J', p: 0, ad: 'D' }), 'sell');
  assert.equal(sideOf({ k: 'S' }), 'sell', 'a sale with no price follows its code');
  assert.equal(sideOf({ k: 'P', p: 10, ad: 'D' }), 'buy');
});

test('applyDirection puts stored rows right from the raw fields, once, and leaves the rest alone', () => {
  const rows = [
    { a: 'x', li: 0, k: 'G', s: 531, o: 2373, oc: -18.3 },
    { a: 'x', li: 1, k: 'G', s: 531, o: 5888.168, oc: -8.3 },
    { a: 'y', li: 0, k: 'J', s: 100, o: 0, oc: null },
    { a: 'z', li: 0, k: 'P', s: 10, o: 110, oc: 10 },
    { a: 'n', li: 0, k: 'G', s: 5, o: 95, oc: -5 },
  ];
  const raw = { 'x:0': { ad: 'D' }, 'x:1': { ad: 'A' }, 'y:0': { ad: 'D' }, 'z:0': { ad: 'D' } };
  const rawOf = (r) => raw[`${r.a}:${r.li}`] || null;
  assert.equal(applyDirection(rows, rawOf), 2);
  assert.deepEqual(rows[0], { a: 'x', li: 0, k: 'G', s: 531, o: 2373, oc: -18.3 });
  assert.equal(rows[1].oc, 9.9);
  assert.equal(rows[1].ad, 'A');
  assert.equal(rows[2].ad, 'D');
  assert.equal(rows[2].oc, -100, 'the whole holding went out');
  assert.equal(rows[3].ad, undefined);
  assert.equal(rows[3].oc, 10);
  assert.equal(rows[4].oc, -5, 'no raw fields on file: untouched');
  assert.equal(applyDirection(rows, rawOf), 0, 'a second pass changes nothing');
  assert.equal(ownershipChange(531, null, false), null);
});

// ------------------------------------------------------------ forward return

const days = (start, n, close) => Array.from({ length: n }, (_, i) => ({ date: new Date(Date.parse(`${start}T00:00:00Z`) + i * 864e5).toISOString().slice(0, 10), close: typeof close === 'function' ? close(i) : close }));

test('BOT: a buy before the series begins has no 30-day outcome — it read −11 points, which was SPY\'s own rise', () => {
  const bot = days('2026-05-11', 120, 39); // listed 34 days after the 7 April buy
  const spy = days('2026-03-01', 250, (i) => 500 + i); // rising
  assert.equal(forwardExcess(bot, spy, '2026-04-07', 30), null);
  assert.equal(forwardExcess(bot, spy, '2026-04-07', 90), null);
  assert.equal(forwardExcess(bot, spy, '2026-05-11', 30), -5.3, 'from the first close on it is known');
  const stored = lateBaseExcess(bot, spy, '2026-04-07', 30);
  assert.ok(stored < 0, 'what the bug stored: a flat stock minus the index');
});

test('annotateOutcomes removes exactly the values that bug stored and keeps an outcome from a series that did cover the trade', () => {
  const bot = days('2026-05-11', 120, 39);
  const spy = days('2026-03-01', 250, (i) => 500 + i);
  const buy = (x) => ({ t: 'BOT', k: 'P', p: 10, s: 100, d: '2026-04-07', a: 'acc', ...x });
  const bugged = buy({ x30: lateBaseExcess(bot, spy, '2026-04-07', 30), x90: lateBaseExcess(bot, spy, '2026-04-07', 90) });
  const earlier = buy({ x30: 12.5, x90: -3.1 }); // computed when a longer series was on file
  annotateOutcomes([bugged, earlier], () => bot, spy);
  assert.equal('x30' in bugged, false);
  assert.equal('x90' in bugged, false);
  assert.equal(earlier.x30, 12.5);
  assert.equal(earlier.x90, -3.1);
});

// ------------------------------------------------------------------ congress

test('an exact amount with cents is one number: $710.52, not a range from 710 to 52', () => {
  assert.deepEqual(parseAmount('$710.52'), { lo: 710.52, hi: 710.52 });
  assert.equal(amountMid(parseAmount('$710.52')), 710.52, 'it went into the volume totals as 381');
  assert.deepEqual(parseAmount('$2,722.50'), { lo: 2722.5, hi: 2722.5 });
  assert.deepEqual(parseAmount('$1,001.00 - $15,000.00'), { lo: 1001, hi: 15000 });
  assert.deepEqual(parseAmount('$1,001 - $15,000'), { lo: 1001, hi: 15000 });
  assert.deepEqual(parseAmount('Over $50,000,000'), { lo: 50000001, hi: null });
  assert.deepEqual(parseAmount('$15'), { lo: 15, hi: 15 });
  assert.equal(backwardsAmount({ lo: 710, hi: 52 }), true);
  assert.equal(backwardsAmount({ lo: 1001, hi: 15000 }), false);
  assert.equal(backwardsAmount({ lo: 50000001, hi: null }), false);
});

// --------------------------------------------------------------------- audit

const spec = (key) => DATASETS.find((d) => d.key === key);
const warns = (key, current) => auditDataset({ spec: spec(key), current }).findings.filter((f) => f.severity === 'warn').map((f) => f.rule);

test('the audit now says so: a split-sized daily return, a backwards amount, a cap no company has, a break nobody is fixing', () => {
  const ret = (ret1d) => ({ ret1y: 1, retYtd: 1, ret1d, asOf: '2026-11-09' });
  const many = Object.fromEntries(Array.from({ length: 120 }, (_, i) => [`T${i}`, ret(1)]));
  assert.deepEqual(warns('returns', { updatedAt: 'x', returns: { ...many, ARAY: ret(3372.73) } }), ['split']);
  assert.deepEqual(warns('returns', { updatedAt: 'x', returns: { ...many, UP: ret(180), DOWN: ret(-70) } }), []);

  const members = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`M${i}`, {}]));
  const rows = Array.from({ length: 3200 }, (_, i) => ({ id: `H:${i}`, m: 'M1', d: '2026-01-01', f: '2026-01-02', lo: 1001, hi: 15000 }));
  assert.deepEqual(warns('congress', { updatedAt: 'x', members, rows }), []);
  assert.deepEqual(warns('congress', { updatedAt: 'x', members, rows: [...rows, { id: 'H:x', m: 'M1', d: '2026-01-01', f: '2026-01-02', lo: 710, hi: 52 }] }), ['amount']);

  const caps = auditDataset({ spec: spec('guru-stocks'), current: { updatedAt: 'x', managers: {}, stocks: [{ ticker: 'TSM', marketCap: 11.8e12 }, { ticker: 'NVDA', marketCap: 5e12 }] } }).findings.filter((f) => f.rule === 'cap');
  assert.equal(caps.length, 1);
  assert.match(caps[0].message, /TSM \$11\.8T/);

  const idx = (oldest) => ({ updatedAt: '2026-11-20T02:00:00Z', count: 5000, coveragePct: 99, unverified: { count: 2, oldest, symbols: ['ARAY', 'INM'] } });
  assert.deepEqual(warns('prices', idx('2026-11-19')), [], 'last night\'s break is tonight\'s job');
  assert.deepEqual(warns('prices', idx('2026-11-09')), ['split']);
});
