import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFlowTree } from '../api/_lib/flowTree.js';

const R = (cusip, sector, netFlow, value, extra = {}) => ({ cusip, ticker: cusip, issuer: cusip, sector, netFlow, value, diffFunds: 5, funds: 5, ...extra });

test('buildFlowTree groups by sector, sizes by |flow|, sorts, filters', () => {
  const rows = [R('A', 'Technology', 100, 1000), R('B', 'Technology', -40, 400), R('C', 'Energy', -300, 3000), R('D', null, 5, 50), { ...R('E', 'Energy', 999, 1), diffFunds: 0 }, R('F', 'Energy', 1, 10)];
  const t = buildFlowTree(rows, { minAbsFlow: 2 });
  assert.deepEqual(t.children.map((c) => c.name), ['Energy', 'Technology', 'Other']);
  const tech = t.children[1];
  assert.deepEqual([tech.flow, tech.inflow, tech.outflow, tech.size, tech.count], [60, 100, -40, 140, 2]);
  assert.ok(Math.abs(tech.intensity - 60 / 1400) < 1e-12);
  assert.deepEqual(tech.children.map((s) => s.name), ['A', 'B']);
  assert.equal(t.totalIn, 105);
  assert.equal(t.totalOut, -340);
  assert.equal(buildFlowTree(rows, { metric: 'in' }).children.every((c) => c.children.every((s) => s.flow > 0)), true);
  assert.equal(buildFlowTree(rows, { maxPerSector: 1 }).children[1].children.length, 1);
});
