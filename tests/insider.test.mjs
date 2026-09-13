import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyTransaction, findClusters, rowClass, selectScanDays } from '../api/_lib/insiderModel.js';
import { buildTeaser, buildPennyBoard, isPenny } from '../api/_lib/insiderTeaser.js';

test('transaction taxonomy: conviction / liquidity / noise', () => {
  assert.equal(classifyTransaction('P'), 'conviction');
  assert.equal(classifyTransaction('C'), 'conviction');
  assert.equal(classifyTransaction('M'), 'conviction', 'exercise-and-hold');
  assert.equal(classifyTransaction('M', { sameFilingSale: true }), 'liquidity', 'exercise cash-out');
  assert.equal(classifyTransaction('S'), 'liquidity');
  assert.equal(classifyTransaction('D'), 'liquidity', 'tender / disposition to issuer');
  for (const c of ['A', 'F', 'G', 'W', 'J', 'I']) assert.equal(classifyTransaction(c), 'noise', c);
  assert.equal(rowClass({ k: 'S' }), 'liquidity', 'legacy rows without cl');
  assert.equal(rowClass({ k: 'M', cl: 'liquidity' }), 'liquidity', 'stored class wins');
});

test('cluster detector: ≥2 distinct insiders, code P, 7-day window', () => {
  const rows = [
    { t: 'ABC', k: 'P', n: 'A', d: '2026-05-01', v: 100 },
    { t: 'ABC', k: 'P', n: 'B', d: '2026-05-06', v: 200 },
    { t: 'ABC', k: 'P', n: 'C', d: '2026-05-20', v: 300 }, // outside the window of the first two
    { t: 'XYZ', k: 'P', n: 'A', d: '2026-05-01', v: 100 },
    { t: 'XYZ', k: 'P', n: 'A', d: '2026-05-02', v: 100 }, // same insider twice ≠ cluster
    { t: 'QQQ', k: 'S', n: 'A', d: '2026-05-01', v: 100 },
    { t: 'QQQ', k: 'S', n: 'B', d: '2026-05-01', v: 100 }, // sales never cluster
  ];
  const c = findClusters(rows);
  assert.deepEqual([...c.keys()], ['ABC']);
  assert.equal(c.get('ABC').insiders, 2);
  assert.equal(c.get('ABC').value, 300);
});

test('teaser: pulse, highlight and signals from a dataset', () => {
  const rows = [
    { t: 'ABC', k: 'P', n: 'Alice', r: 'ceo', d: '2026-05-01', f: '2026-05-02', v: 50000, p: 4.5, s: 1000 },
    { t: 'ABC', k: 'P', n: 'Bob', r: 'director', d: '2026-05-03', f: '2026-05-04', v: 30000, p: 4.6, s: 500 },
    { t: 'DEF', k: 'S', n: 'Carol', r: 'cfo', d: '2026-05-03', f: '2026-05-04', v: 900000, p: 40, s: 100 },
    { t: 'NONE', k: 'P', n: 'Fund', r: 'owner10', d: '2026-05-04', f: '2026-05-04', v: 5e6, p: 10, s: 1 },
  ];
  const t = buildTeaser(rows, { ABC: 'Abc Corp' }, {}, Date.parse('2026-05-05'));
  assert.equal(t.lastDay, '2026-05-04');
  assert.equal(t.pulse.sellCount, 1);
  assert.equal(t.highlight.t, 'ABC', 'unlisted NONE rows are ignored');
  assert.equal(t.signals.cluster[0].t, 'ABC');
  assert.deepEqual(t.signals.cluster[0].roles, ['ceo']);
  assert.equal(t.signals.csuite[0].n, 'Alice');
  assert.equal(t.signals.penny.length, 1, 'one row per ticker');
});

test('penny threshold: the transaction price, strictly under $5 and above zero', () => {
  assert.equal(isPenny({ p: 4.99 }), true);
  assert.equal(isPenny({ p: 5 }), false, '$5 is not a penny stock');
  assert.equal(isPenny({ p: 0 }), false, 'a $0 price means the field is missing');
  assert.equal(isPenny({ p: null }), false);
  assert.equal(isPenny({}), false);
});

test('penny board: window, floor, open-market only, one row per ticker', () => {
  const rows = [
    // two insiders in ABC inside 7 days -> a cluster, biggest buy takes the slot
    { t: 'ABC', k: 'P', n: 'Alice', r: 'ceo', ti: 'CEO', d: '2026-05-01', f: '2026-05-04', v: 50000, p: 4.5, s: 1000, o: 4000, oc: 33.3 },
    { t: 'ABC', k: 'P', n: 'Bob', r: 'director', d: '2026-05-05', f: '2026-05-06', v: 90000, p: 4.6, s: 500, o: 500 },
    { t: 'DEF', k: 'S', n: 'Carol', r: 'cfo', d: '2026-05-03', f: '2026-05-04', v: 40000, p: 2, s: 20000, o: 0 },
    { t: 'GHI', k: 'P', n: 'Dan', r: 'ceo', d: '2026-05-03', f: '2026-05-04', v: 9000, p: 1, s: 9000 }, // under the floor
    { t: 'JKL', k: 'P', n: 'Erin', r: 'ceo', d: '2026-05-03', f: '2026-05-04', v: 80000, p: 40, s: 2000 }, // not a penny stock
    { t: 'MNO', k: 'A', n: 'Fay', r: 'ceo', d: '2026-05-03', f: '2026-05-04', v: 80000, p: 1, s: 80000 }, // a grant, not open market
    { t: 'PQR', k: 'P', n: 'Gil', r: 'ceo', d: '2026-01-02', f: '2026-01-03', v: 80000, p: 1, s: 80000 }, // before the window
  ];
  const b = buildPennyBoard(rows, { ABC: 'Abc Corp' }, {}, '2026-05-06');

  assert.deepEqual(b.rows.map((r) => r.t), ['ABC'], 'buys only, one row per ticker, above the floor');
  assert.equal(b.rows[0].n, 'Bob', 'the biggest buy takes the ticker slot');
  assert.equal(b.rows[0].ins, 2, 'the row reports the cluster size');
  assert.equal(b.rows[0].c, 'Abc Corp');
  assert.equal(b.rows[0].nw, true, 'owned after == shares bought is a new position');
  assert.equal(b.rows[0].lag, 1, 'business days between trade and filing');

  assert.equal(b.stats.buyCount, 2, 'both ABC buys count');
  assert.equal(b.stats.buyValue, 140000);
  assert.equal(b.stats.sellCount, 1, 'the penny sale counts');
  assert.equal(b.stats.sellValue, 40000);
  assert.equal(b.stats.companies, 2, 'ABC and DEF');
  assert.equal(b.stats.insiders, 2, 'distinct buyers');
  assert.equal(b.stats.clusterCount, 1);
  assert.equal(b.signals[0].kind, 'cluster');
  assert.equal(b.top.sells[0].t, 'DEF');
  assert.equal(b.since, '2026-04-06', 'the window trails the newest filing day');
});

test('penny board: price enrichment is optional and additive', () => {
  const rows = [{ t: 'ABC', k: 'P', n: 'Alice', r: 'ceo', d: '2026-05-01', f: '2026-05-04', v: 50000, p: 2, s: 25000, o: 30000, oc: 20 }];
  const bare = buildPennyBoard(rows, {}, {}, '2026-05-06').rows[0];
  for (const k of ['px', 'ret', 'off', 'vol', 'sz']) assert.equal(k in bare, false, `${k} is absent without meta`);
  assert.equal(bare.p, 2, 'the transaction price always survives');

  const rich = buildPennyBoard(rows, {}, { ABC: { px: 3, lo: 1.5, vol: 100000, mcap: 50e6, sector: 'Energy' } }, '2026-05-06').rows[0];
  assert.equal(rich.px, 3);
  assert.equal(rich.ret, 50, 'return from the transaction price');
  assert.equal(rich.off, 100, 'distance above the 52-week low');
  assert.equal(rich.vol, 300000, 'dollar volume = price x average shares');
  assert.equal(rich.sz, 'micro');
});

test('teaser still carries the landing-page keys alongside the penny board', () => {
  const rows = [
    { t: 'ABC', k: 'P', n: 'Alice', r: 'ceo', d: '2026-05-01', f: '2026-05-02', v: 50000, p: 4.5, s: 1000 },
    { t: 'DEF', k: 'S', n: 'Carol', r: 'cfo', d: '2026-05-03', f: '2026-05-04', v: 900000, p: 40, s: 100 },
  ];
  const t = buildTeaser(rows, {}, {}, Date.parse('2026-05-05'));
  for (const k of ['pulse', 'highlight', 'signals', 'rows', 'penny']) assert.ok(k in t, k);
  assert.ok(Array.isArray(t.signals.penny), 'the landing page still reads signals.penny');
  assert.equal(t.penny.rows[0].t, 'ABC');
  assert.equal(t.penny.maxPrice, 5);
});

test('crawl plan: a holiday EDGAR never published does not stall the checkpoint', () => {
  // 2026-05-22 Fri stored; 2026-05-25 Mon is Memorial Day, so EDGAR published
  // no daily index for it. Asking for it returns 403, which the crawler used
  // to read as a ban and stop — freezing the dataset on that date.
  const q2 = new Set(['2026-05-26', '2026-05-27', '2026-05-28', '2026-05-29']); // no 05-25
  const plan = selectScanDays({
    fromDay: '2026-05-22',
    today: '2026-05-29',
    published: () => q2,
    maxDays: 25,
  });
  assert.deepEqual(plan.skipped, ['2026-05-25'], 'the holiday is dropped, not requested');
  assert.equal(plan.days[0], '2026-05-26', 'the scan starts the day after');
  assert.equal(plan.checkpoint, '2026-05-25', 'the checkpoint clears the holiday even if every fetch fails');
  assert.equal(plan.remaining, 0);
});

test('crawl plan: weekends skipped, backlog capped, remainder reported', () => {
  const plan = selectScanDays({ fromDay: '2026-05-22', today: '2026-06-30', published: () => null, maxDays: 5 });
  assert.equal(plan.days.length, 5);
  assert.equal(plan.days[0], '2026-05-25', 'an unreadable listing keeps every candidate day');
  assert.ok(plan.remaining > 0, 'the rest is left for the next run');
  for (const d of [...plan.days, ...plan.skipped]) {
    const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
    assert.ok(dow !== 0 && dow !== 6, `${d} is a weekday`);
  }
});

test('crawl plan: nothing to do when the checkpoint is current', () => {
  const plan = selectScanDays({ fromDay: '2026-05-29', today: '2026-05-29', published: () => null });
  assert.deepEqual(plan.days, []);
  assert.equal(plan.checkpoint, '2026-05-29', 'the checkpoint holds');
  assert.equal(plan.remaining, 0);
});

test('crawl plan: a run of holidays still advances the checkpoint', () => {
  const plan = selectScanDays({ fromDay: '2026-05-22', today: '2026-05-26', published: () => new Set(), maxDays: 25 });
  assert.deepEqual(plan.days, [], 'nothing to fetch');
  assert.equal(plan.checkpoint, '2026-05-26', 'moves past every unpublished day');
});
