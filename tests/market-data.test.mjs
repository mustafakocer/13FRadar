import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sicToSector,
  frameNames,
  latestShares,
  marketCap,
  chartSnapshot,
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

// A chart the way Yahoo returns it: unix timestamps, a close per bar, the
// live price in meta. Built for a "now" of 2026-09-19 with the last bar being
// the live session of the 18th.
function chart({ live = true } = {}) {
  const days = [];
  const start = Date.UTC(2025, 8, 15); // 2025-09-15
  for (let i = 0; i < 370; i++) {
    const t = start + i * 86400 * 1000;
    const d = new Date(t);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    days.push(Math.floor(t / 1000));
  }
  const closes = days.map((_, i) => 100 + i * 0.5); // rising steadily
  const volumes = days.map(() => 1000);
  const last = days[days.length - 1];
  return {
    meta: {
      regularMarketPrice: live ? closes[closes.length - 1] : closes[closes.length - 1],
      regularMarketTime: last + 6 * 3600,
      instrumentType: 'EQUITY',
      currency: 'USD',
      fiftyTwoWeekLow: 100,
      fiftyTwoWeekHigh: 230,
    },
    timestamp: days,
    indicators: { quote: [{ close: closes, volume: volumes }] },
    _closes: closes,
    _days: days,
  };
}

test('returns are measured from the right bars', () => {
  const c = chart();
  const now = Date.parse('2026-09-19T12:00:00Z');
  const s = chartSnapshot(c, now);
  const price = c._closes[c._closes.length - 1];
  assert.equal(s.price, price);
  assert.equal(s.asOf, new Date(c._days[c._days.length - 1] * 1000).toISOString().slice(0, 10));
  // 1D: against the bar before the session the price belongs to
  const prev = c._closes[c._closes.length - 2];
  assert.equal(s.ret1d.toFixed(4), (((price - prev) / prev) * 100).toFixed(4));
  // YTD: against the last close of the previous year
  const iso = (secs) => new Date(secs * 1000).toISOString().slice(0, 10);
  let ytdIx = -1;
  c._days.forEach((d, i) => {
    if (iso(d) < '2026-01-01') ytdIx = i;
  });
  const ytdBase = c._closes[ytdIx];
  assert.equal(s.retYtd.toFixed(4), (((price - ytdBase) / ytdBase) * 100).toFixed(4));
  // 1Y: against the first bar on or after a year ago
  const yearAgo = new Date(now - 365 * 86400 * 1000).toISOString().slice(0, 10);
  const yIx = c._days.findIndex((d) => iso(d) >= yearAgo);
  const yBase = c._closes[yIx];
  assert.equal(s.ret1y.toFixed(4), (((price - yBase) / yBase) * 100).toFixed(4));
  assert.equal(s.vol, 1000);
  assert.equal(s.lo, 100);
  assert.equal(s.hi, 230);
  assert.equal(s.etf, false);
});

test('a live session price is compared with the previous close, not itself', () => {
  const c = chart();
  // the provider marks the market time as the last bar's own day: the last
  // bar is today, the previous close is the bar before
  const s = chartSnapshot(c, Date.parse('2026-09-19T12:00:00Z'));
  assert.notEqual(s.ret1d, 0);
});

test('funds are flagged and empty charts are nothing', () => {
  const c = chart();
  c.meta.instrumentType = 'ETF';
  assert.equal(chartSnapshot(c).etf, true);
  assert.equal(chartSnapshot({ meta: {}, timestamp: [], indicators: { quote: [{ close: [] }] } }), null);
  assert.equal(chartSnapshot(null), null);
});

test('null closes (holidays, halts) are skipped rather than counted', () => {
  const c = chart();
  c.indicators.quote[0].close[c._closes.length - 2] = null;
  const s = chartSnapshot(c, Date.parse('2026-09-19T12:00:00Z'));
  const price = c._closes[c._closes.length - 1];
  const prev = c._closes[c._closes.length - 3];
  assert.equal(s.ret1d.toFixed(4), (((price - prev) / prev) * 100).toFixed(4));
});
