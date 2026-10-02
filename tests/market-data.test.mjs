import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sicToSector,
  frameNames,
  latestShares,
  marketCap,
  seriesSnapshot,
  priceSnapshots,
  SECTORS,
} from '../api/_lib/marketData.js';

// The key-less sources behind sector, market cap and the return columns.
// Everything that does arithmetic on a provider's answer is exercised here
// on the answer's shape, so a wrong number cannot hide behind a green build.

test('SIC codes fold into the sectors the screener speaks', () => {
  assert.equal(sicToSector(3571), 'Technology'); // Apple: electronic computers
  assert.equal(sicToSector('6331'), 'Financial Services'); // Berkshire: insurance
  assert.equal(sicToSector(2834), 'Healthcare'); // pharmaceutical preparations
  assert.equal(sicToSector(2836), 'Healthcare'); // biological products
  assert.equal(sicToSector(1311), 'Energy'); // crude petroleum
  assert.equal(sicToSector(6798), 'Real Estate'); // REIT
  assert.equal(sicToSector(4911), 'Utilities');
  assert.equal(sicToSector(4813), 'Communication Services');
  assert.equal(sicToSector(5961), 'Consumer Cyclical'); // Amazon: catalog & mail-order
  assert.equal(sicToSector(5331), 'Consumer Defensive'); // Walmart: variety stores
  assert.equal(sicToSector(7372), 'Technology'); // prepackaged software
  assert.equal(sicToSector(3674), 'Technology'); // semiconductors
  assert.equal(sicToSector(1531), 'Consumer Cyclical'); // homebuilders
  assert.equal(sicToSector(3711), 'Consumer Cyclical'); // motor vehicles
  assert.equal(sicToSector(3721), 'Industrials'); // aircraft
  assert.equal(sicToSector(8731), 'Healthcare'); // commercial research (biotech)
  assert.equal(sicToSector(2860), 'Basic Materials'); // industrial organic chemicals
});

test('every mapped sector is one the site already filters by', () => {
  const seen = new Set();
  for (let code = 100; code < 9000; code++) {
    const s = sicToSector(code);
    if (s) seen.add(s);
  }
  for (const s of seen) assert.ok(SECTORS.includes(s), `${s} is not a known sector`);
});

test('a fund, a blank and nonsense have no sector', () => {
  assert.equal(sicToSector(''), null);
  assert.equal(sicToSector(null), null);
  assert.equal(sicToSector(undefined), null);
  assert.equal(sicToSector('abc'), null);
  assert.equal(sicToSector(9721), null); // public administration
});

test('the frames asked for are this quarter and the ones before it', () => {
  assert.deepEqual(frameNames(new Date('2026-09-19T00:00:00Z')), ['CY2026Q3I', 'CY2026Q2I', 'CY2026Q1I', 'CY2025Q4I']);
  assert.deepEqual(frameNames(new Date('2026-01-05T00:00:00Z'), 2), ['CY2026Q1I', 'CY2025Q4I']);
});

test('the most recently dated share count wins across frames', () => {
  const shares = latestShares([
    { data: [{ cik: 320193, val: 14594180000, end: '2026-07-17' }] },
    null, // a frame that could not be fetched
    { data: [{ cik: 320193, val: 14687356000, end: '2026-04-17' }, { cik: 1750, val: 39764268, end: '2026-02-28' }] },
    { data: [{ cik: 1750, val: 0, end: '2025-11-30' }, { cik: 99, val: 'n/a', end: '2025-11-30' }] },
  ]);
  assert.equal(shares.get('0000320193').shares, 14594180000);
  assert.equal(shares.get('0000320193').end, '2026-07-17');
  assert.equal(shares.get('0000001750').shares, 39764268, 'a zero never replaces a real count');
  assert.equal(shares.has('0000000099'), false, 'a non-number is not a count');
});

test('market cap is shares times price, or nothing', () => {
  assert.equal(marketCap(14594180000, 336.13), Math.round(14594180000 * 336.13));
  assert.equal(marketCap(0, 336.13), null);
  assert.equal(marketCap(1e9, null), null);
  assert.equal(marketCap(undefined, 10), null);
});

// ~400 daily bars ending 2026-09-18, from the price store's shape
function bars() {
  const out = [];
  let t = Date.parse('2025-08-14T00:00:00Z');
  let px = 100;
  while (t <= Date.parse('2026-09-18T00:00:00Z')) {
    const d = new Date(t);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) {
      px = Number((px * (1 + Math.sin(out.length / 7) / 100)).toFixed(4));
      out.push({ date: d.toISOString().slice(0, 10), close: px });
    }
    t += 86400000;
  }
  return out;
}

test('returns and the 52-week range are measured from the stored closes', () => {
  const b = bars();
  const now = Date.parse('2026-09-19T12:00:00Z');
  const s = seriesSnapshot(b, now);
  const price = b.at(-1).close;
  assert.equal(s.price, price);
  assert.equal(s.asOf, '2026-09-18');
  const prev = b.at(-2).close;
  assert.equal(s.ret1d.toFixed(4), (((price - prev) / prev) * 100).toFixed(4));
  const ytdBase = b.filter((x) => x.date < '2026-01-01').at(-1).close;
  assert.equal(s.retYtd.toFixed(4), (((price - ytdBase) / ytdBase) * 100).toFixed(4));
  const yearAgo = new Date(now - 365 * 86400 * 1000).toISOString().slice(0, 10);
  const yBase = b.find((x) => x.date >= yearAgo).close;
  assert.equal(s.ret1y.toFixed(4), (((price - yBase) / yBase) * 100).toFixed(4));
  const year = b.filter((x) => x.date >= yearAgo).map((x) => x.close);
  assert.equal(s.lo, Math.min(...year));
  assert.equal(s.hi, Math.max(...year));
  assert.equal(s.vol, null, 'no volume in the store: none borrowed');
});

test('a listing younger than a year has no 1Y return; empty series are nothing', () => {
  const b = bars().filter((x) => x.date >= '2026-06-12');
  const s = seriesSnapshot(b, Date.parse('2026-09-19T12:00:00Z'));
  assert.equal(s.ret1y, null);
  assert.equal(s.retYtd, null);
  assert.equal(seriesSnapshot([]), null);
  assert.equal(seriesSnapshot(null), null);
});

test('priceSnapshots reads the store and asks no provider', () => {
  const store = { AAA: { prices: bars() }, BBB: null };
  const { snapshots, failed, blocked } = priceSnapshots(['AAA', 'BBB'], { now: Date.parse('2026-09-19T12:00:00Z'), read: (t) => store[t] });
  assert.equal(snapshots.get('AAA').asOf, '2026-09-18');
  assert.equal(snapshots.get('BBB'), null);
  assert.deepEqual([failed, blocked], [0, false]);
});
