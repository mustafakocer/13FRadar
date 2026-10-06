// The estimated purchase price of a guru's position (api/_lib/costBasis.js)
// and the columns it adds to /api/guru-history: a count that rises buys at
// the quarter's average close, a fall sells at average cost, a full exit
// starts over, and a purchase quarter without closes withholds the number.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import './helpers.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cost-'));
process.env.PRICES_DIR = dir;

const { costBasis, gainPct, quarterStats, quarterWindow } = await import('../api/_lib/costBasis.js');
const { writeSeries, clearSeriesCache } = await import('../api/_lib/priceStore.js');
const { invoke } = await import('../api/_lib/ssr/invoke.js');

const DAY = 86400 * 1000;
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
// weekdays from..to at one flat close per calendar quarter: Q1 2026 = 100,
// Q2 2026 = 200, so every average is exact and every window obvious
function flat(from, to, closeOf) {
  const out = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += DAY) {
    const dow = new Date(t).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    out.push({ date: iso(t), close: closeOf(iso(t)) });
  }
  return out;
}
const byQuarter = (d) => (d <= '2025-12-31' ? 50 : d <= '2026-03-31' ? 100 : d <= '2026-06-30' ? 200 : 300);
const prices = flat('2025-10-01', '2026-09-30', byQuarter);
const quarters = ['2025-12-31', '2026-03-31', '2026-06-30', '2026-09-30'].map((reportDate) => ({ reportDate }));
// a position is "open" when it has a line in the last quarter of the list:
// these cases end at Q2 2026
const toQ2 = quarters.slice(0, 3);

test('quarter window and stats: after the previous quarter end, through this one', () => {
  assert.deepEqual(quarterWindow('2026-03-31', '2025-12-31'), { from: '2025-12-31', to: '2026-03-31' });
  assert.equal(quarterWindow('2026-03-31').from, '2025-12-30'); // 91 days back without a previous quarter
  const s = quarterStats(prices, '2025-12-31', '2026-03-31');
  assert.equal(s.avg, 100);
  assert.equal(s.lo, 100);
  assert.equal(s.hi, 100);
  assert.equal(quarterStats(prices, '2027-01-01', '2027-03-31'), null, 'no closes in the window');
});

test('buys at the quarter average, sells at average cost, exit resets the lot', () => {
  // 100 shares bought in Q1 2026 (@100), 100 more in Q2 (@200): average 150
  let cb = costBasis({ quarters: toQ2, series: [['2026-03-31', 100, 1, 1], ['2026-06-30', 200, 1, 1]], prices });
  assert.equal(cb.avgBuy, 150);
  assert.equal(cb.lotShares, 200);
  assert.equal(cb.lotCost, 30000);
  assert.equal(cb.since, '2026-03-31');
  assert.equal(cb.openedBeforeData, false);
  // then 50 sold in Q3: the average does not move, the cost shrinks
  cb = costBasis({ quarters, series: [['2026-03-31', 100, 1, 1], ['2026-06-30', 200, 1, 1], ['2026-09-30', 150, 1, 1]], prices });
  assert.equal(cb.avgBuy, 150);
  assert.equal(cb.lotShares, 150);
  assert.equal(cb.lotCost, 22500);
  assert.deepEqual(Object.keys(cb.byQuarter), ['2026-03-31', '2026-06-30', '2026-09-30']);
  assert.equal(cb.byQuarter['2026-09-30'].avg, 300);
  // held in Q1, gone in Q2, back in Q3: only the Q3 purchase counts
  cb = costBasis({ quarters, series: [['2026-03-31', 100, 1, 1], ['2026-09-30', 10, 1, 1]], prices });
  assert.equal(cb.avgBuy, 300);
  assert.equal(cb.since, '2026-09-30');
  assert.ok(cb.byQuarter['2026-06-30'], 'the exit quarter still gets its price row');
  // fully exited (no line in the last quarter): nothing open
  cb = costBasis({ quarters: toQ2, series: [['2026-03-31', 100, 1, 1]], prices });
  assert.equal(cb.avgBuy, null);
  assert.equal(cb.lotShares, 0);
});

test('a position held in the first quarter of the data is priced at that quarter and flagged', () => {
  const cb = costBasis({ quarters: toQ2, series: [['2025-12-31', 100, 1, 1], ['2026-03-31', 100, 1, 1], ['2026-06-30', 100, 1, 1]], prices });
  assert.equal(cb.avgBuy, 50);
  assert.equal(cb.openedBeforeData, true);
  assert.equal(cb.since, '2025-12-31');
});

test('a purchase quarter without closes withholds the estimate instead of guessing', () => {
  const late = prices.filter((p) => p.date > '2026-04-01'); // nothing for Q1
  const cb = costBasis({ quarters: toQ2, series: [['2026-03-31', 100, 1, 1], ['2026-06-30', 200, 1, 1]], prices: late });
  assert.equal(cb.avgBuy, null);
  assert.equal(cb.unpriced, true);
  assert.equal(cb.lotShares, 200);
  // …but a sale in an unpriced quarter is fine: it needs no price
  const noQ3 = prices.filter((p) => p.date <= '2026-06-30');
  const sold = costBasis({ quarters, series: [['2026-03-31', 100, 1, 1], ['2026-06-30', 200, 1, 1], ['2026-09-30', 150, 1, 1]], prices: noQ3 });
  assert.equal(sold.avgBuy, 150);
});

test('gain against the estimate; cheap stocks keep four decimals', () => {
  assert.equal(gainPct(150, 300), 100);
  assert.equal(gainPct(150, 75), -50);
  assert.equal(gainPct(null, 300), null);
  const cents = costBasis({ quarters: toQ2.slice(0, 2), series: [['2026-03-31', 100, 1, 1]], prices: prices.map((p) => ({ ...p, close: p.close / 1000 })) });
  assert.equal(cents.avgBuy, 0.1);
});

test('guru-history handler: cost per open position and the pair page columns', async () => {
  // the fixture's Berkshire: AAPL held both quarters (2026-03-31, 2026-06-30),
  // CMG only in the first
  const H = JSON.parse(fs.readFileSync(process.env.GURU_HISTORY_FILE, 'utf8'));
  const g = H.gurus['0001067983'];
  const aapl = Object.entries(g.positions).find(([, e]) => e.ticker === 'AAPL');
  assert.ok(aapl);
  const [, e] = aapl;
  const [q1, q2] = e.series.map((r) => r[1]);
  writeSeries('AAPL', flat('2025-12-01', '2026-10-05', (d) => (d <= '2026-03-31' ? 100 : d <= '2026-06-30' ? 200 : 250)));
  writeSeries('CMG', flat('2025-12-01', '2026-10-05', () => 40));
  clearSeriesCache();
  const { default: handler } = await import('../api/_handlers/guru-history.js');
  const all = await invoke(handler, { cik: '0001067983' });
  assert.equal(all.status, 200);
  const cost = all.body.cost;
  const c = Object.values(cost).find((x) => x.ticker === 'AAPL');
  assert.ok(c, 'AAPL is open, so it is priced');
  // the first quarter on file is the opening lot, at Q1's average; Q2 only sold
  assert.equal(c.avgBuy, 100);
  assert.equal(c.openedBeforeData, true);
  assert.equal(c.current, 250);
  assert.equal(c.gainPct, 150);
  assert.ok(q2 < q1, 'fixture: the count fell in Q2');
  assert.equal(Object.values(cost).some((x) => x.ticker === 'CMG'), false, 'an exited position has no open lot');
  const pair = await invoke(handler, { cik: '0001067983', ticker: 'AAPL' });
  assert.equal(pair.body.cost.avgBuy, 100);
  assert.equal(pair.body.rows[0].avgClose, 100);
  assert.equal(pair.body.rows[1].avgClose, 200);
  assert.deepEqual([pair.body.rows[1].lo, pair.body.rows[1].hi], [200, 200]);
});
