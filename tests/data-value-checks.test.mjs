import test from 'node:test';
import assert from 'node:assert/strict';
import { auditDataset, DATASETS } from '../api/_lib/dataAudit.js';
import {
  guruPerformanceChecks,
  fxChecks,
  returnsChecks,
  returnsMetrics,
  benchmarkChecks,
  tickerMetaMetrics,
  listOf,
} from '../api/_lib/dataValueChecks.js';

// The values inside the files: a benchmark with a bad print, a rate stored
// upside down, a fund "returning" thousands of percent in a quarter.

const rules = (fs) => fs.map((f) => `${f.severity}:${f.rule}`).sort();
const spec = (key) => DATASETS.find((d) => d.key === key);

// ---------------------------------------------------------------- guru performance

const period = (from, to, port, spy, coverage = 1, extra = {}) => ({ from, to, port, spy, coverage, ...extra });
const chainOf = (ps, k) => Number(((ps.reduce((a, p) => a * (1 + p[k] / 100), 1) - 1) * 100).toFixed(1));

function guru(periods, over = {}) {
  const win = periods.slice(-4);
  const port = chainOf(win, 'port');
  const spy = chainOf(win, 'spy');
  return {
    name: 'Fund',
    asOf: periods.at(-1).to,
    current: true,
    periods,
    horizons: {
      y1: { port, spy, coverage: 1, from: win[0].from, to: win.at(-1).to, diff: Number((port - spy).toFixed(1)) },
      y3: { port: null, spy: null, coverage: null, from: null, diff: null },
      ...over,
    },
  };
}

const goodPeriods = () => [
  period('2025-06-30', '2025-09-30', 5.12, 3.4),
  period('2025-09-30', '2025-12-31', -2.5, 1.1),
  period('2025-12-31', '2026-03-31', 8.01, 4.2),
  period('2026-03-31', '2026-06-30', 3.33, 2.0),
];

test('a guru file whose horizons follow from their periods says nothing', () => {
  const d = { byCik: { a: guru(goodPeriods()), b: guru(goodPeriods()) } };
  assert.deepEqual(guruPerformanceChecks(d), []);
});

test('a horizon that is not the chain of its periods blocks', () => {
  const g = guru(goodPeriods());
  g.horizons.y1 = { ...g.horizons.y1, port: g.horizons.y1.port + 5, diff: g.horizons.y1.diff + 5 };
  assert.deepEqual(rules(guruPerformanceChecks({ byCik: { a: g } })), ['error:perf-arith']);
});

test('a diff that is not port minus SPY blocks', () => {
  const g = guru(goodPeriods());
  g.horizons.y1.diff += 1;
  assert.deepEqual(rules(guruPerformanceChecks({ byCik: { a: g } })), ['error:perf-arith']);
});

test('two gurus reading two different SPY returns for one window blocks', () => {
  const other = goodPeriods();
  other[3] = { ...other[3], spy: 2.5 };
  const d = { byCik: { a: guru(goodPeriods()), b: guru(other) } };
  assert.deepEqual(rules(guruPerformanceChecks(d)), ['error:perf-benchmark']);
});

test('a quarter no long-only book can return blocks; a big but possible one warns', () => {
  const huge = goodPeriods();
  huge[0] = { ...huge[0], port: 2900 };
  const big = goodPeriods();
  big[0] = { ...big[0], port: 140 };
  assert.deepEqual(rules(guruPerformanceChecks({ byCik: { a: guru(huge) } })), ['error:perf-outlier']);
  assert.deepEqual(rules(guruPerformanceChecks({ byCik: { a: guru(big) } })), ['warn:perf-outlier']);
});

test('an SPY quarter of +60% is a bad print', () => {
  const ps = goodPeriods();
  ps[1] = { ...ps[1], spy: 60 };
  assert.ok(rules(guruPerformanceChecks({ byCik: { a: guru(ps) } })).includes('error:perf-benchmark'));
});

test('a return answered on less than half the book blocks', () => {
  const ps = goodPeriods();
  ps[2] = { ...ps[2], coverage: 0.3 };
  assert.deepEqual(rules(guruPerformanceChecks({ byCik: { a: guru(ps) } })), ['error:perf-coverage']);
});

test('a guru-performance file with the horizons gone collapses its count', () => {
  const s = spec('guru-performance');
  const full = { updatedAt: 'x', asOf: '2026-06-30', byCik: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`c${i}`, guru(goodPeriods())])) };
  const empty = structuredClone(full);
  for (const g of Object.values(empty.byCik)) g.horizons.y1 = { port: null, spy: null, coverage: null, from: null, diff: null };
  const r = auditDataset({ spec: s, current: empty, baseline: full });
  assert.ok(r.findings.some((f) => f.rule === 'floor' && f.metric === 'withY1' && f.severity === 'error'));
  assert.ok(r.findings.some((f) => f.rule === 'drift' && f.metric === 'withY1' && f.severity === 'error'));
});

// ---------------------------------------------------------------- exchange rates

const days = (n, start = '2026-01-01') =>
  Array.from({ length: n }, (_, i) => new Date(Date.parse(`${start}T00:00:00Z`) + i * 86400000).toISOString().slice(0, 10));
const series = (values, start) => days(values.length, start).map((d, i) => [d, values[i]]);
const flat = (v, n = 60) => Array.from({ length: n }, (_, i) => v * (1 + (i % 3) * 0.001));

test('a year of ordinary rates says nothing', () => {
  const d = { rates: { EUR: series(flat(1.12)), JPY: series(flat(0.0063)) }, issuers: { 1: { t: 'TM', cur: 'JPY', ads: 1, ratio: 10 } } };
  assert.deepEqual(fxChecks(d), []);
});

test('a rate stored upside down blocks', () => {
  const v = flat(0.0063);
  v[v.length - 1] = 158; // yen per dollar where dollars per yen belong
  assert.ok(rules(fxChecks({ rates: { JPY: series(v) }, issuers: {} })).includes('error:fx-level'));
});

test('a third in a day blocks, a tenth warns, and only on the recent rows', () => {
  const crash = flat(0.03);
  crash[crash.length - 1] = 0.02;
  assert.ok(rules(fxChecks({ rates: { TRY: series(crash) }, issuers: {} })).includes('error:fx-jump'));
  const dip = flat(0.03);
  dip[dip.length - 1] = 0.027;
  assert.deepEqual(rules(fxChecks({ rates: { TRY: series(dip) }, issuers: {} })), ['warn:fx-jump']);
  const old = flat(0.03);
  old[5] = 0.02; // a spike months ago was audited the night it arrived
  assert.deepEqual(rules(fxChecks({ rates: { TRY: series(old) }, issuers: {} })), []);
});

test('a zero, a negative or an out-of-order rate blocks', () => {
  assert.ok(rules(fxChecks({ rates: { EUR: series([1.1, 0, 1.1]) }, issuers: {} })).includes('error:fx-shape'));
  assert.ok(rules(fxChecks({ rates: { EUR: [['2026-01-02', 1.1], ['2026-01-01', 1.1]] }, issuers: {} })).includes('error:fx-shape'));
});

test('a currency days behind the rest warns; an unpriced issuer currency is only noted', () => {
  const d = { rates: { EUR: series(flat(1.12, 30)), GBP: series(flat(1.3, 10)) }, issuers: { 1: { t: 'YPF', cur: 'ARS' } } };
  assert.deepEqual(rules(fxChecks(d)), ['info:fx-missing', 'warn:fx-stale']);
});

test('an ADR ratio of zero blocks', () => {
  const d = { rates: { EUR: series(flat(1.12)) }, issuers: { 1: { t: 'X', ads: 1, ratio: 0 } } };
  assert.deepEqual(rules(fxChecks(d)), ['error:adr-ratio']);
});

test('the drift override turns a real devaluation into a warning, never broken arithmetic', () => {
  const s = spec('fpi');
  const crash = flat(0.03);
  crash[crash.length - 1] = 0.02;
  const issuers = Object.fromEntries(Array.from({ length: 250 }, (_, i) => [`${i}`, { t: `T${i}`, cur: 'TRY' }]));
  const rates = Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`C${i}`, series(flat(1 + i))]));
  const current = { updatedAt: 'x', rates: { ...rates, TRY: series(crash) }, issuers };
  assert.ok(auditDataset({ spec: s, current }).findings.some((f) => f.rule === 'fx-jump' && f.severity === 'error'));
  const waved = auditDataset({ spec: s, current, allowDrift: true });
  assert.ok(waved.findings.some((f) => f.rule === 'fx-jump' && f.severity === 'warn' && /override/.test(f.message)));
  assert.ok(!waved.findings.some((f) => f.severity === 'error'));

  const broken = { ...current, rates: { ...rates, TRY: series([0.03, -1, 0.03]) } };
  assert.ok(auditDataset({ spec: s, current: broken, allowDrift: true }).findings.some((f) => f.rule === 'fx-shape' && f.severity === 'error'));
});

// ---------------------------------------------------------------- returns

const ret = (ret1d, retYtd, ret1y, asOf = '2026-10-16') => ({ ret1d, retYtd, ret1y, asOf });
const quietReturns = (n = 200) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`T${i}`, ret((i % 7) - 3, (i % 30) - 10, (i % 50) - 20)]));

test('an ordinary day of returns says nothing', () => {
  assert.deepEqual(returnsChecks({ returns: quietReturns() }), []);
});

test('one ticker with a broken year is named, the largest first, and does not block', () => {
  const r = { ...quietReturns(), WHLR: ret(-5, -100, -100), CUEN: ret(0, 400000, 614900) };
  const found = returnsChecks({ returns: r });
  assert.deepEqual(rules(found), ['warn:returns-extreme']);
  assert.match(found[0].message, /CUEN.*WHLR/);
});

test('extreme returns across the list are the price cache, not the market', () => {
  const r = quietReturns(100);
  for (let i = 0; i < 5; i++) r[`T${i}`] = ret(0, 0, 5000);
  assert.deepEqual(rules(returnsChecks({ returns: r })), ['error:returns-systemic', 'warn:returns-extreme']);
});

test('the whole list moving 30% in a day blocks', () => {
  const r = Object.fromEntries(Object.entries(quietReturns()).map(([t, x]) => [t, { ...x, ret1d: 30 }]));
  assert.deepEqual(rules(returnsChecks({ returns: r })), ['error:returns-systemic']);
});

test('a list mostly days behind its newest close warns', () => {
  const r = Object.fromEntries(Object.entries(quietReturns()).map(([t, x], i) => [t, { ...x, asOf: i < 50 ? '2026-10-16' : '2026-10-01' }]));
  assert.deepEqual(rules(returnsChecks({ returns: r })), ['warn:returns-stale']);
});

test('returns: a non-number blocks, and fewer extremes than last night is not a collapse', () => {
  const s = spec('returns');
  const base = { updatedAt: 'x', returns: { ...quietReturns(), ...Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`X${i}`, ret(0, 0, -99.9)])) } };
  const fixed = { updatedAt: 'x', returns: quietReturns() };
  const r = auditDataset({ spec: s, current: fixed, baseline: base });
  assert.ok(!r.findings.some((f) => f.metric === 'extreme'), 'extreme is not measured for drift');
  assert.equal(returnsMetrics({ returns: { A: ret('12%', 0, 0) } }).nonNumeric, 1);
  const bad = auditDataset({ spec: s, current: { updatedAt: 'x', returns: { ...quietReturns(), A: ret('12%', 0, 0) } } });
  assert.ok(bad.findings.some((f) => f.rule === 'ceiling' && f.metric === 'nonNumeric'));
});

// ---------------------------------------------------------------- benchmarks

const bench = (closes, from = '2016-01-04') => ({ symbol: 'SPY', from, asOf: 'x', d: closes.map((_, i) => (i === 0 ? 0 : 1)), c: closes });

test('an ordinary benchmark series says nothing', () => {
  assert.deepEqual(benchmarkChecks(bench([400, 404, 398, 401, 410])), []);
});

test('a benchmark that moves a fifth in a day is a bad print, dated', () => {
  const found = benchmarkChecks(bench([400, 404, 40.4, 401]));
  assert.deepEqual(rules(found), ['error:bench-jump']);
  assert.match(found[0].message, /2016-01-06 404→40\.4/);
});

test('a benchmark with a missing or zero close, or dates out of step, blocks', () => {
  assert.deepEqual(rules(benchmarkChecks(bench([400, 0, 401]))), ['error:bench-shape']);
  assert.deepEqual(rules(benchmarkChecks({ ...bench([400, 401]), d: [0] })), ['error:bench-shape']);
  assert.deepEqual(rules(benchmarkChecks({ ...bench([400, 401]), d: [0, -1] })), ['error:bench-shape']);
});

test('SPY, QQQ and IWM are each audited, and a truncated series is a collapse', () => {
  for (const k of ['bench-spy', 'bench-qqq', 'bench-iwm']) assert.ok(spec(k), `${k} is registered`);
  const long = bench(Array.from({ length: 2500 }, (_, i) => 300 + (i % 5)));
  const short = bench(Array.from({ length: 900 }, (_, i) => 300 + (i % 5)));
  const r = auditDataset({ spec: spec('bench-spy'), current: short, baseline: long });
  assert.ok(r.findings.some((f) => f.rule === 'floor' && f.severity === 'error'));
  assert.ok(r.findings.some((f) => f.rule === 'drift' && f.severity === 'error'));
});

// ---------------------------------------------------------------- ticker meta and the rest

test('a 52-week low above its high or a negative market cap blocks', () => {
  assert.deepEqual(tickerMetaMetrics({ A: { px: 5, lo: 6, hi: 4 }, B: { px: 1, mcap: -5 }, C: { px: null } }), {
    symbols: 3,
    priced: 2,
    invertedRange: 1,
    negativeCap: 1,
  });
  const meta = Object.fromEntries(Array.from({ length: 1200 }, (_, i) => [`T${i}`, { px: 10, lo: 5, hi: 12, mcap: 1e9 }]));
  const r = auditDataset({ spec: spec('ticker-meta'), current: { ...meta, BAD: { px: 10, lo: 12, hi: 5 } } });
  assert.deepEqual(rules(r.findings.filter((f) => f.severity !== 'info')), ['error:ceiling']);
});

test('every file a workflow commits is inside the gate', () => {
  for (const key of ['guru-performance', 'fpi', 'fundamentals', 'ticker-meta', 'company-names', 'cusip-tickers', 'filer-meta', 'insiders-raw', 'insiders-raw-backfill']) {
    assert.ok(spec(key), `${key} is registered`);
  }
});

test('a long list is cut with a count of the rest', () => {
  assert.equal(listOf(['a', 'b', 'c'], 2), 'a, b … (+1)');
  assert.equal(listOf(['a', 'b']), 'a, b');
});
