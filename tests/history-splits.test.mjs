// The guru history's share counts, turnover, changes and AUM: splits that
// arrive after a quarter was stored, spin-off price factors that are not
// splits, a CUSIP that changes under a holding, and option notional that is
// not equity. Pure functions first, then the stored file itself.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { reconcileSplits, factorsCarried, isShareSplit, splitKey } from '../api/_lib/history.js';
import { splitAdjustPrev } from '../api/_lib/splitAdjust.js';
import { turnover } from '../api/_lib/turnover.js';
import { portfolioChanges } from '../client/src/lib/portfolioChanges.js';
import { netActivity } from '../api/_lib/netActivity.js';
import { aumHistoryFromGuru, aumRowFromSnapshot, attachFlows } from '../api/_lib/managerHistory.js';
import { changesFromHistory } from '../api/_lib/holdingsChanges.js';

const H = JSON.parse(fs.readFileSync(new URL('../api/_data/guru-history.json', import.meta.url), 'utf8'));
const S = JSON.parse(fs.readFileSync(new URL('../api/_data/splits.json', import.meta.url), 'utf8')).byTicker;
const guru = (prefix) => Object.values(H.gurus).find((g) => g.name.startsWith(prefix));
const rowAt = (e, d) => e.series.find((r) => r[0] === d);

// ---- splits on stored rows ---------------------------------------------------

test('reconcileSplits: a split that lands after a row was stored still reaches it, once', () => {
  const crwd = [{ date: '2026-07-02', ratio: 4 }];
  const stored = [['2026-03-31', 100, 40000, 1], ['2026-06-30', 120, 48000, 1]];
  // stored before the split was known: nothing applied yet
  const a = reconcileSplits(stored, [], crwd, new Set());
  assert.deepEqual(a.series.map((r) => r[1]), [400, 480]);
  assert.deepEqual(a.applied, ['2026-07-02:4']);
  // the next night: the new quarter is fresh (raw, post-split), the rest carry it
  const b = reconcileSplits([...a.series, ['2026-09-30', 500, 50000, 1]], a.applied, crwd, new Set(['2026-09-30']));
  assert.deepEqual(b.series.map((r) => r[1]), [400, 480, 500], 'nothing adjusted twice');
  // a split splits.json no longer lists is taken back out
  const c = reconcileSplits(b.series, b.applied, [], new Set());
  assert.deepEqual(c.series.map((r) => r[1]), [100, 120, 500]);
  assert.deepEqual(c.applied, []);
});

test('reconcileSplits: a spin-off price factor never changes a share count', () => {
  const ge = [{ date: '2023-01-04', ratio: 1.281 }, { date: '2024-04-02', ratio: 1.253 }];
  const { series, applied } = reconcileSplits([['2024-03-31', 4030213, 1, 1]], null, ge, new Set(['2024-03-31']));
  assert.equal(series[0][1], 4030213);
  assert.deepEqual(applied, []);
  assert.equal(splitKey({ date: '2026-07-02', ratio: 4 }), '2026-07-02:4');
});

test('factorsCarried: reads the applied factors off the implied price', () => {
  const after = [{ date: '2024-04-02', ratio: 1.253 }, { date: '2026-07-02', ratio: 2 }];
  // raw $160 a share; the fully adjusted close is 160 / (1.253 × 2)
  const close = 160 / (1.253 * 2);
  assert.ok(Math.abs(factorsCarried([0, 1000, 160000], after, close) - 1) < 1e-9, 'raw row: nothing carried');
  assert.ok(Math.abs(factorsCarried([0, 1253, 160000], after, close) - 1.253) < 1e-9, 'spin factor carried');
  assert.ok(Math.abs(factorsCarried([0, 2506, 160000], after, close) - 2.506) < 1e-9, 'both carried');
  assert.equal(factorsCarried([0, 1000, 160000], after, null), null, 'no close, no answer');
  assert.equal(factorsCarried([0, 1700, 160000], after, close), null, 'nothing explains it');
});

test('turnover on split-adjusted shares: a 10-for-1 with no trade is 0%', () => {
  const splits = { NVDA: [{ date: '2024-06-10', ratio: 10 }] };
  const tickerOf = () => 'NVDA';
  const prev = { aum: 1000, positions: [{ cusip: '67066G104', shares: 100, value: 1000 }] };
  const cur = { aum: 1200, positions: [{ cusip: '67066G104', shares: 1000, value: 1200 }] };
  assert.ok(turnover(prev, cur).turnover > 90, 'raw counts read the split as buying');
  const adj = splitAdjustPrev(prev, '2024-03-31', '2024-06-30', { tickerOf, splits });
  assert.equal(turnover(adj, cur).turnover, 0);
});

// ---- a CUSIP change is one holding ---------------------------------------------

test('portfolioChanges keys by ticker: a re-CUSIP is not an exit plus a new line; options stay separate', () => {
  const prev = [
    { cusip: '143658300', ticker: 'CCL', issuer: 'CARNIVAL CORP', shares: 1000, value: 25000, weight: 5 },
    { cusip: '143658300', ticker: 'CCL', putCall: 'Call', issuer: 'CARNIVAL CORP', shares: 500, value: 12000, weight: 2 },
  ];
  const cur = [
    { cusip: 'G2004J103', ticker: 'CCL', issuer: 'CARNIVAL CORP LTD', shares: 1100, value: 30000, weight: 6 },
    { cusip: 'G2004J103', ticker: 'CCL', putCall: 'Put', issuer: 'CARNIVAL CORP LTD', shares: 300, value: 8000, weight: 1 },
  ];
  const ch = portfolioChanges(cur, prev);
  assert.deepEqual(ch.counts, { new: 1, added: 1, reduced: 0, exited: 1 });
  assert.equal(ch.added[0].cusip, 'G2004J103');
  assert.equal(ch.added[0].pct, 10);
  assert.equal(ch.new[0].putCall, 'Put');
  assert.equal(ch.exited[0].putCall, 'Call');
  // no ticker: the CUSIP is the key, as before
  assert.equal(portfolioChanges([{ cusip: 'A', shares: 1, value: 1 }], [{ cusip: 'B', shares: 1, value: 1 }]).counts.exited, 1);
  // two lines of one book on one key are added together
  const two = portfolioChanges([{ cusip: 'X1', ticker: 'X', shares: 10, value: 10 }, { cusip: 'X2', ticker: 'X', shares: 5, value: 5 }], [{ cusip: 'X1', ticker: 'X', shares: 15, value: 15 }]);
  assert.deepEqual(two.counts, { new: 0, added: 0, reduced: 0, exited: 0 });
});

test('netActivity: the default identity is the ticker, so a re-CUSIP is not a new buyer', () => {
  const m = (cik) => ({
    cik,
    name: cik,
    reportDate: '2026-06-30',
    prev: { positions: [{ cusip: '143658300', ticker: 'CCL', shares: 100, value: 2500, weight: 1 }] },
    cur: { positions: [{ cusip: 'G2004J103', ticker: 'CCL', shares: 100, value: 2900, weight: 1 }] },
  });
  const rows = netActivity([m('A'), m('B')]);
  assert.equal(rows.size, 1);
  const r = rows.get('CCL');
  assert.equal(r.newBuyers, 0);
  assert.equal(r.exiters, 0);
  assert.equal(r.netValue, 0);
});

// ---- AUM without option notional -----------------------------------------------

test('AUM history is the equity book; a window that cannot say so gets no flows', () => {
  const q = (reportDate, aum, putCallValue, count = 4) => ({ reportDate, acc: reportDate, filed: reportDate, aum, count, ...(putCallValue != null ? { putCallValue } : {}) });
  // Scion 2025: $1.38B reported, $68M of it stock
  const scion = { quarters: [q('2025-06-30', 578337040, 522082750), q('2025-09-30', 1381198076, 1313060000)] };
  const h = aumHistoryFromGuru(scion);
  assert.equal(h[1].aum, 1381198076 - 1313060000);
  assert.equal(h[1].reportedAum, 1381198076);
  assert.equal(h[1].basis, 'equity');
  attachFlows(h, (d) => (d === '2025-06-30' ? 100 : 110));
  assert.ok(Math.abs(h[1].estFlow) < 0.1e9, `no $0.8B phantom inflow (${h[1].estFlow})`);
  // options known only for the newest quarter of an options-heavy fund
  const citadel = { quarters: [q('2026-03-31', 600e9, null), q('2026-06-30', 875e9, 700e9)] };
  const c = attachFlows(aumHistoryFromGuru(citadel), () => 100);
  assert.equal(c[1].basis, 'reported');
  assert.equal(c[1].estFlow, null);
  // a fund with no option lines where it is known stays on the equity basis
  const plain = aumHistoryFromGuru({ quarters: [q('2026-03-31', 100, null), q('2026-06-30', 120, 0)] });
  assert.equal(plain[1].basis, 'equity');
  // the EDGAR path counts the same way
  const row = aumRowFromSnapshot({ acc: 'a', filingDate: 'f', reportDate: 'r' }, { aum: 100, positions: [{ value: 60 }, { value: 40, putCall: 'Put' }] });
  assert.deepEqual([row.aum, row.positions, row.optionLines], [60, 1, 1]);
});

// ---- the stored file -------------------------------------------------------------

test('stored history: spin-offs are not sales, splits reached every row, Carnival is one holding', () => {
  const trian = guru('Trian');
  const ge = Object.values(trian.positions).find((e) => e.ticker === 'GE');
  assert.equal(rowAt(ge, '2024-03-31')[1], 4030213, 'GE 2024Q1 in GE shares, not × the GE Vernova factor');
  assert.equal(rowAt(ge, '2024-06-30')[1], 4030213);
  const gates = Object.values(guru('Gates').positions).find((e) => e.ticker === 'FDX');
  assert.equal(rowAt(gates, '2026-03-31')[1], rowAt(gates, '2026-06-30')[1], 'FDX: the Freight spin is not a sale');

  // every row carries exactly the real splits after it, and says so
  for (const g of Object.values(H.gurus)) {
    for (const [c, e] of Object.entries(g.positions)) {
      const want = (S[e.ticker] || []).filter((s) => isShareSplit(s.ratio)).map(splitKey).sort();
      assert.deepEqual(e.splitsApplied || [], want, `${g.name} ${c} ${e.ticker}`);
    }
  }
  const inmd = Object.values(guru('Renaissance').positions).find((e) => e.ticker === 'INMD');
  assert.ok(inmd.splitsApplied.includes('2021-10-01:2'));

  const viking = guru('Viking');
  const ch = changesFromHistory(viking, '2026-06-30');
  assert.ok(!ch.new.some((p) => p.ticker === 'CCL'), 'not a new Carnival position');
  assert.ok(!ch.exited.some((p) => /^CCL/.test(p.ticker || '')), 'not a Carnival exit');
});

test('stored turnover compares split-adjusted shares', () => {
  const at = (prefix, d) => guru(prefix).quarters.find((q) => q.reportDate === d);
  assert.equal(at('RV Capital', '2026-06-30').turnover, 11.7);
  assert.equal(at('Pershing', '2024-06-30').turnover, 14.33);
  assert.equal(at('Altimeter', '2024-06-30').turnover, 13.32);
  for (const g of Object.values(H.gurus)) for (const q of g.quarters) assert.equal(q.turnoverBasis, 'split-adjusted', `${g.name} ${q.reportDate}`);
});
