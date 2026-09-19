import test from 'node:test';
import assert from 'node:assert/strict';
import {
  size,
  driftVerdict,
  auditDataset,
  auditAll,
  worstOf,
  DATASETS,
  MIN_BASELINE,
} from '../api/_lib/dataAudit.js';

// The gate that decides whether a rebuilt dataset is publishable. These are the
// cases that actually happened, or that would have gone unnoticed if they had.

const spec = {
  key: 'demo',
  path: 'demo.json',
  require: ['updatedAt', 'rows'],
  metrics: (d) => ({ rows: size(d.rows), names: size(d.names) }),
  floors: { rows: 100 },
};
const good = { updatedAt: '2026-09-17T00:00:00Z', rows: new Array(500).fill(0), names: { a: 1, b: 2 } };
const withRows = (n) => ({ ...good, rows: new Array(n).fill(0) });
const severities = (r) => r.findings.map((f) => f.severity);
const rules = (r) => r.findings.map((f) => f.rule);

test('rows are counted whichever shape the file keeps them in', () => {
  assert.equal(size([1, 2, 3]), 3);
  assert.equal(size({ a: 1, b: 2 }), 2);
  assert.equal(size(16632), 16632, 'a count already given as a number is taken as given');
  assert.equal(size(null), null);
  assert.equal(size('12'), null, 'a string is not a count');
  assert.equal(size(undefined), null);
  assert.equal(size(NaN), null);
});

test('a dataset that rebuilt into roughly itself says nothing', () => {
  const r = auditDataset({ spec, current: withRows(510), baseline: withRows(500) });
  assert.deepEqual(r.findings, [], '2% is a rebuild, not an event');
  assert.equal(r.metrics.rows, 510);
});

test('a big move warns, a collapse blocks', () => {
  const warn = auditDataset({ spec, current: withRows(320), baseline: withRows(500) });
  assert.deepEqual(severities(warn), ['warn'], '-36% is worth saying out loud');
  const error = auditDataset({ spec, current: withRows(150), baseline: withRows(500) });
  assert.deepEqual(severities(error), ['error'], '-70% is a bad upstream day');
  assert.match(error.findings[0].message, /rows moved -70\.0%, 500 → 150/);
});

test('growth is watched as closely as loss', () => {
  const r = auditDataset({ spec, current: withRows(1200), baseline: withRows(500) });
  assert.deepEqual(severities(r), ['error'], 'a file that triples is as suspect as one that halves');
});

test('a tiny baseline cannot produce a percentage worth acting on', () => {
  assert.equal(driftVerdict(3, 2), null, 'two rows becoming three is not a 50% event');
  assert.equal(driftVerdict(5, MIN_BASELINE - 1), null);
  assert.ok(driftVerdict(5, MIN_BASELINE), 'at the threshold it counts again');
});

test('drift needs two numbers, and says nothing without them', () => {
  assert.equal(driftVerdict(100, null), null);
  assert.equal(driftVerdict(undefined, 100), null);
  assert.equal(driftVerdict(100, 0), null, 'nothing can be measured against zero');
});

test('the first build of a dataset is not a failure', () => {
  const r = auditDataset({ spec, current: good, baseline: null });
  assert.deepEqual(severities(r), ['info']);
  assert.deepEqual(rules(r), ['drift']);
});

test('a floor catches the file that survived as an empty shell', () => {
  const r = auditDataset({ spec, current: withRows(4), baseline: null });
  assert.ok(r.findings.some((f) => f.rule === 'floor' && f.severity === 'error'));
  assert.match(r.findings[0].message, /rows is 4, below the floor of 100/);
});

test('the drift override waves through an intended jump and nothing else', () => {
  const jumped = { spec, current: withRows(2000), baseline: withRows(500) };
  assert.deepEqual(severities(auditDataset(jumped)), ['error']);
  const waved = auditDataset({ ...jumped, allowDrift: true });
  assert.deepEqual(severities(waved), ['warn'], 'the bench going from 20 names to 99 is real');
  assert.match(waved.findings[0].message, /drift override on/);

  // A floor is a statement about the file being broken, not about how much it
  // moved, so no override reaches it.
  const empty = auditDataset({ spec, current: withRows(3), baseline: withRows(500), allowDrift: true });
  assert.ok(empty.findings.some((f) => f.rule === 'floor' && f.severity === 'error'));
});

test('a missing required key blocks, and is never drift', () => {
  const { updatedAt, ...noStamp } = good;
  const r = auditDataset({ spec, current: noStamp, baseline: good });
  assert.ok(r.findings.some((f) => f.rule === 'missing-key' && f.severity === 'error'));
  assert.match(r.findings[0].message, /no "updatedAt"/);
});

test('a file that is absent blocks, unless it was only ever optional', () => {
  assert.deepEqual(severities(auditDataset({ spec, current: null })), ['error']);
  assert.deepEqual(severities(auditDataset({ spec: { ...spec, optional: true }, current: null })), ['info']);
});

test('junk where a dataset should be is reported, not thrown', () => {
  assert.deepEqual(severities(auditDataset({ spec, current: [1, 2, 3] })), ['error']);
  const throws = { ...spec, metrics: () => { throw new Error('boom'); } };
  const r = auditDataset({ spec: throws, current: good });
  assert.deepEqual(severities(r), ['error']);
  assert.match(r.findings[0].message, /boom/);
});

test('a baseline that cannot be counted skips drift instead of failing the run', () => {
  const half = { ...spec, metrics: (d) => { if (d.legacy) throw new Error('old shape'); return { rows: size(d.rows) }; } };
  const r = auditDataset({ spec: half, current: good, baseline: { legacy: true } });
  assert.deepEqual(severities(r), ['info']);
  assert.match(r.findings[0].message, /previous version could not be counted/);
});

test('the worst finding anywhere is the verdict the build acts on', () => {
  assert.equal(worstOf(['ok', 'info', 'warn']), 'warn');
  assert.equal(worstOf(['warn', 'error', 'info']), 'error');
  assert.equal(worstOf([]), 'ok');
  const report = auditAll([
    { spec, current: withRows(500), baseline: withRows(500) },
    { spec: { ...spec, key: 'other' }, current: withRows(10), baseline: null },
  ]);
  assert.equal(report.worst, 'error');
  assert.equal(report.datasets.length, 2);
  assert.deepEqual(report.datasets[0].findings, []);
});

test('every dataset the builds commit is registered, once, with a real counter', () => {
  const keys = DATASETS.map((d) => d.key);
  assert.equal(new Set(keys).size, keys.length, 'no dataset is registered twice');
  const paths = DATASETS.map((d) => d.path);
  assert.equal(new Set(paths).size, paths.length, 'no file is audited twice');
  for (const d of DATASETS) {
    assert.equal(typeof d.metrics, 'function', `${d.key} has no counter`);
    assert.ok(d.path.endsWith('.json'), `${d.key} has an odd path`);
    for (const floor of Object.values(d.floors || {})) {
      assert.ok(Number.isFinite(floor) && floor >= 0, `${d.key} has a nonsense floor`);
    }
  }
  // The feed goes empty between filing deadlines, so neither rule may fire on
  // it: 81 rows in the week after a deadline and near zero a month later is
  // the feed working, not the feed breaking.
  for (const key of ['filings', 'filer-states']) {
    const d = DATASETS.find((x) => x.key === key);
    assert.deepEqual(d.floors, {}, `${key} must not carry a floor`);
    assert.equal(d.drift, false, `${key} must not be measured for drift`);
  }
});

test('a seasonal dataset is exempt from drift but not from being whole', () => {
  const seasonal = { ...spec, drift: false, floors: {} };
  // 500 rows to none is what the filings feed does between deadlines
  const r = auditDataset({ spec: seasonal, current: withRows(0), baseline: withRows(500) });
  assert.deepEqual(r.findings, [], 'an emptied seasonal feed is not an incident');
  assert.equal(r.metrics.rows, 0, 'the count is still reported');

  const { rows, ...noRows } = withRows(0);
  const broken = auditDataset({ spec: seasonal, current: noRows, baseline: withRows(500) });
  assert.ok(broken.findings.some((f) => f.rule === 'missing-key' && f.severity === 'error'), 'a missing key still blocks');
});
