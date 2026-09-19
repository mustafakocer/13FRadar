import test from 'node:test';
import assert from 'node:assert/strict';
import { auditDataset, count, laggingManagers, DATASETS } from '../api/_lib/dataAudit.js';

// The rules the data can never break, next to the counts and the drift.

const rules = (r) => r.findings.map((f) => `${f.severity}:${f.rule}`);

test('a soft floor warns and does not block', () => {
  const spec = { key: 'demo', path: 'demo.json', require: [], metrics: (d) => ({ rows: d.rows.length, withSector: count(d.rows, (r) => r.sector) }), floors: {}, warnFloors: { withSector: 2 }, drift: false };
  const bad = auditDataset({ spec, current: { rows: [{ sector: null }, { sector: null }, { sector: 'Energy' }] } });
  assert.deepEqual(rules(bad), ['warn:floor']);
  const good = auditDataset({ spec, current: { rows: [{ sector: 'Energy' }, { sector: 'Utilities' }] } });
  assert.deepEqual(rules(good), []);
});

test('a ceiling of zero is an invariant: one row over it blocks the commit', () => {
  const spec = { key: 'demo', path: 'demo.json', require: [], metrics: (d) => ({ futureDated: count(d.rows, (r) => r.d > r.f) }), floors: {}, ceilings: { futureDated: 0 }, drift: false };
  const bad = auditDataset({ spec, current: { rows: [{ d: '2027-09-03', f: '2026-09-03' }] } });
  assert.deepEqual(rules(bad), ['error:ceiling']);
  const good = auditDataset({ spec, current: { rows: [{ d: '2026-09-01', f: '2026-09-03' }] } });
  assert.deepEqual(rules(good), []);
});

test('custom checks land as findings and a broken check is a warning, not a crash', () => {
  const spec = { key: 'demo', path: 'demo.json', require: [], metrics: () => ({}), floors: {}, drift: false, checks: (d) => (d.bad ? [{ severity: 'warn', rule: 'custom', message: 'bad' }] : []) };
  assert.deepEqual(rules(auditDataset({ spec, current: { bad: true } })), ['warn:custom']);
  assert.deepEqual(rules(auditDataset({ spec, current: { bad: false } })), []);
  const broken = { ...spec, checks: () => { throw new Error('boom'); } };
  assert.deepEqual(rules(auditDataset({ spec: broken, current: {} })), ['warn:check']);
});

test('a fund a quarter behind the panel median is named', () => {
  const managers = [
    ...Array.from({ length: 8 }, (_, i) => ({ cik: `${i}`, name: `Fund ${i}`, reportDate: '2026-06-30' })),
    { cik: 'x', name: 'Scion', reportDate: '2025-09-30' },
    { cik: 'y', name: 'Late filer', reportDate: '2026-03-31' },
  ];
  const found = laggingManagers(managers);
  assert.deepEqual(found.map((f) => f.cik).sort(), ['x', 'y']);
  assert.match(found[0].message, /panel median 2026-06-30/);
  assert.deepEqual(laggingManagers(managers.slice(0, 3)), [], 'too few funds for a median to mean anything');
});

test('the live specs carry the new rules', () => {
  const guru = DATASETS.find((d) => d.key === 'guru-stocks');
  assert.ok(guru.warnFloors.withSector > 0);
  const ins = DATASETS.find((d) => d.key === 'insiders');
  assert.equal(ins.ceilings.futureDated, 0);
  assert.equal(ins.metrics({ rows: [{ d: '2027-01-01', f: '2026-01-01' }, { d: '2026-01-01', f: '2026-01-02' }], companies: {} }).futureDated, 1);
  const pro = DATASETS.find((d) => d.key === 'consensus-pro');
  assert.equal(typeof pro.checks, 'function');
});
