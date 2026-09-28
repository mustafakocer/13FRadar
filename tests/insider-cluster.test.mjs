// Cluster buy rules (roadmap item 3) on real Form 4 lines
// (tests/fixtures/cluster-cases.json, frozen 2026-09-28) and a few
// constructed ones. api/_lib/insiderCluster.js is the one definition.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildClusters, lineLabels, exclusionOf, CLUSTER, compareClusters } from '../api/_lib/insiderCluster.js';
import { buildTeaser } from '../api/_lib/insiderTeaser.js';
import { usdPerUnit } from '../api/_lib/fx.js';
import { resetServedCache } from '../api/_lib/insiderStore.js';

const F = JSON.parse(fs.readFileSync(new URL('./fixtures/cluster-cases.json', import.meta.url)));
const toUsd = (a, cu, d) => {
  const k = usdPerUnit(cu, d, F.rates);
  return k ? a * k : null;
};
const one = (t) => {
  const rows = F.cases[t].map((x) => x.row);
  const raw = new Map(F.cases[t].map((x) => [x.row, x.raw]));
  return buildClusters(rows, { rawOf: (r) => raw.get(r) || null, toUsd });
};

test('TSM: 30 employees the same day at the same price, median under $10K → "Toplu plan alımı", not a cluster', () => {
  const { clusters, excluded } = one('TSM');
  assert.equal(clusters.length, 0);
  const e = excluded.find((x) => x.t === 'TSM');
  assert.deepEqual([e.label, e.why], ['plan_bulk', 'same_day_price']);
  assert.ok(e.people >= CLUSTER.planMinPeople);
  assert.ok(e.median < CLUSTER.planMedianMax, `median $${e.median}`);
});

test('SBLK: directors bought at the offering price a footnote states (EUR 24.50 = $28.27) → "Hisse arzına katılım"', () => {
  const zagari = F.cases.SBLK.find((x) => /Zagari/.test(x.row.n));
  assert.match(Object.values(zagari.raw.fn).join(' '), /Offering undertaken by STAR BULK CARRIERS CORP[^.]*offering price/i);
  const usd = 24.5 * usdPerUnit('EUR', '2026-09-15', F.rates);
  assert.ok(Math.abs(usd / 28.27 - 1) < 0.001, `€24.50 at the H.10 rate = $${usd.toFixed(3)}`);
  const { clusters, excluded } = one('SBLK');
  assert.equal(clusters.length, 0);
  const e = excluded.find((x) => x.t === 'SBLK');
  assert.equal(e.label, 'offering');
  assert.equal(e.people, 8);
  // without the rate, only Zagari's own lines carry the label and the other
  // seven directors would form a cluster — the price rule is what proves it
  const noRate = buildClusters(F.cases.SBLK.map((x) => x.row), { rawOf: (r) => F.cases.SBLK.find((x) => x.row === r).raw });
  assert.equal(noRate.clusters.length, 1);
});

test('BBD: 21 officers the same day at one price, each over $10K, no footnote or remark naming a plan or offering → a real cluster by the rules', () => {
  const notes = F.cases.BBD.map((x) => [Object.values(x.raw?.fn || {}).join(' '), x.raw?.rm || ''].join(' ').trim());
  assert.ok(notes.every((t) => !/plan|offering|placement|issuer|remunerat|compensat/i.test(t)), 'the filings say nothing about how the shares were bought');
  const { clusters, excluded } = one('BBD');
  assert.equal(excluded.length, 0);
  assert.equal(clusters[0].insiders, 21);
  assert.ok(clusters[0].members.every((m) => m.v >= CLUSTER.minPersonValue));
});

test('WIX: every amount unverified (shekels) → not listed at all, neither as a cluster nor as a look-alike', () => {
  assert.ok(F.cases.WIX.every((x) => x.row.fx?.fail));
  const { clusters, excluded } = one('WIX');
  assert.equal(clusters.length + excluded.length, 0);
});

test('RWT: 6 officers and directors over 5 business days → a real cluster', () => {
  const { clusters } = one('RWT');
  assert.equal(clusters.length, 1);
  const c = clusters[0];
  assert.equal(c.insiders, 6);
  assert.ok(c.ceoCfo);
  assert.ok(c.spanDays < CLUSTER.windowBusinessDays);
});

test('KRMN: 3 directors the same day, each ≥ $10K → a real cluster', () => {
  const { clusters } = one('KRMN');
  assert.equal(clusters[0]?.insiders, 3);
});

test('PMTS: the 10% holder fund is listed apart, not counted', () => {
  const { clusters } = one('PMTS');
  const c = clusters[0];
  assert.ok(!c.members.some((m) => /Tricor/.test(m.n)));
  assert.deepEqual(c.others.filter((o) => /Tricor/.test(o.n)).map((o) => o.why), ['fund']);
});

test('a %10+ fund does not count; when it was the second buyer the cluster falls apart', () => {
  const base = { t: 'TPL', k: 'P', d: '2026-09-10', f: '2026-09-11', p: 1000, s: 100, v: 100000 };
  const director = { ...base, n: 'Jane Director', r: 'director', a: 'A1', li: 0 };
  const fund = { ...base, n: 'Horizon Kinetics Asset Management LLC', r: 'owner10', a: 'A2', li: 0, s: 3, v: 3000 };
  const officer = { ...base, n: 'Otto Officer', r: 'officer', a: 'A3', li: 0, d: '2026-09-15' };
  assert.equal(exclusionOf(fund), 'fund');
  assert.equal(buildClusters([director, fund]).clusters.length, 0, 'director + fund is not a cluster');
  const c = buildClusters([director, fund, officer]).clusters[0];
  assert.equal(c.insiders, 2);
  assert.deepEqual(c.others.map((o) => [o.n, o.why]), [['Horizon Kinetics Asset Management LLC', 'fund']]);
});

test('a person under $10K in total, a planned trade and an unverified amount do not count', () => {
  const base = { t: 'ABC', k: 'P', r: 'director', d: '2026-09-10', p: 10 };
  const rows = [
    { ...base, n: 'A', s: 2000, v: 20000, a: '1', li: 0 },
    { ...base, n: 'B', s: 500, v: 5000, a: '2', li: 0 },
    { ...base, n: 'C', s: 2000, v: 20000, a: '3', li: 0, p5: 1 },
    { ...base, n: 'D', s: 2000, v: null, a: '4', li: 0, fx: { fail: 'mismatch', cu: 'ILS' } },
  ];
  assert.equal(buildClusters(rows).clusters.length, 0);
  const whys = Object.fromEntries(buildClusters([...rows, { ...base, n: 'E', s: 2000, v: 20000, a: '5', li: 0 }]).clusters[0].others.map((o) => [o.n, o.why]));
  assert.deepEqual(whys, { B: 'small', C: 'plan', D: 'fx' });
});

test('outside 10 business days is not a cluster', () => {
  const base = { t: 'ABC', k: 'P', r: 'director', p: 10, s: 2000, v: 20000, li: 0 };
  assert.equal(buildClusters([{ ...base, n: 'A', d: '2026-09-01', a: '1' }, { ...base, n: 'B', d: '2026-09-15', a: '2' }]).clusters.length, 0, '10 business days apart');
  assert.equal(buildClusters([{ ...base, n: 'A', d: '2026-09-01', a: '1' }, { ...base, n: 'B', d: '2026-09-14', a: '2' }]).clusters.length, 1, '9 business days apart');
});

test('footnotes: employee purchase plan / dividend reinvestment → plan; private placement → offering', () => {
  const r = (n, note) => ({ t: 'X', k: 'P', r: 'officer', n, d: '2026-09-10', p: 10, s: 2000, v: 20000, a: n, li: 0, note });
  const rows = [r('A', 'Shares purchased under the Employee Stock Purchase Plan.'), r('B', 'Purchased in the private placement directly from the issuer.'), r('C', 'Includes shares acquired through dividend reinvestment plan.')];
  const labels = lineLabels(rows, (x) => ({ fn: { F1: x.note } }));
  assert.deepEqual(rows.map((x) => labels.get(x)?.label), ['plan_bulk', 'offering', 'plan_bulk']);
});

test('order: people, then dollars, then CEO/CFO, then holding increase', () => {
  const c = (insiders, value, ceoCfo, ownIncreaseAvg) => ({ insiders, value, ceoCfo, ownIncreaseAvg });
  const list = [c(2, 5e6, false, 10), c(3, 1e5, false, 1), c(2, 5e6, true, 1), c(2, 5e6, true, 50)].sort(compareClusters);
  assert.deepEqual(list.map((x) => [x.insiders, x.ceoCfo, x.ownIncreaseAvg]), [[3, false, 1], [2, true, 50], [2, true, 1], [2, false, 10]]);
});

test('the home page and /insiders/cluster show the same list the /insiders feed computes', async () => {
  const rows = Object.values(F.cases).flat().map((x) => x.row);
  // the fixture rows are already served (converted) rows: the feed must not
  // convert them again, so the feed's raw store leaves out the security
  // title of converted lines (without it and without an issuer record,
  // fpiNormalize leaves a line alone)
  const raw = Object.fromEntries(Object.values(F.cases).flat().filter((x) => x.raw).map((x) => [`${x.row.a}:${x.row.li}`, x.row.fx ? { ...x.raw, st: undefined } : x.raw]));
  const teaser = buildTeaser(rows, {}, {}, Date.parse('2026-09-28'), { raw, toUsd });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-'));
  fs.writeFileSync(path.join(dir, 'insiders.json'), JSON.stringify({ updatedAt: '2026-09-28T04:00:00Z', rows, companies: {} }));
  fs.writeFileSync(path.join(dir, 'insiders-raw.json'), JSON.stringify({ rows: raw }));
  fs.writeFileSync(path.join(dir, 'fpi.json'), JSON.stringify({ rates: F.rates, issuers: {} }));
  process.env.INSIDER_DATA_DIR = dir;
  resetServedCache();
  try {
    const { answer } = await import('../api/_handlers/insider-feed.js');
    const feed = await answer({ tab: 'latest' }, { free: false });
    const home = teaser.signals.cluster.map((c) => [c.t, c.insiders, c.v]);
    assert.deepEqual(feed.stats.clusters.map((c) => [c.t, c.insiders, c.v]), home);
    assert.deepEqual(home.map((x) => x[0]), ['BBD', 'RWT', 'PMTS', 'KRMN']);
    assert.deepEqual(teaser.signals.clusterExcluded.map((e) => [e.t, e.label]), [['TSM', 'plan_bulk'], ['SBLK', 'offering']]);
  } finally {
    delete process.env.INSIDER_DATA_DIR;
    resetServedCache();
  }
});
