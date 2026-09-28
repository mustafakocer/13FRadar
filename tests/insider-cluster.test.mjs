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
  // the others say so in the filing's remarks (re-read by the backfill)
  const spyrou = F.cases.SBLK.find((x) => /Spyrou/.test(x.row.n));
  assert.match(spyrou.raw.rm, /parallel offering.*offering price of EUR ?24\.50.*28\.27/i);
  const usd = 24.5 * usdPerUnit('EUR', '2026-09-15', F.rates);
  assert.ok(Math.abs(usd / 28.27 - 1) < 0.001, `€24.50 at the H.10 rate = $${usd.toFixed(3)}`);
  const { clusters, excluded } = one('SBLK');
  assert.equal(clusters.length, 0);
  const e = excluded.find((x) => x.t === 'SBLK');
  assert.equal(e.label, 'offering');
  assert.equal(e.people, 8);
  // the price rule alone (footnotes/remarks of the others removed) reaches
  // the same answer: €24.50 at the day's rate is their price
  const onlyZagari = buildClusters(F.cases.SBLK.map((x) => x.row), { rawOf: (r) => (/Zagari/.test(r.n) ? zagari.raw : null), toUsd });
  assert.equal(onlyZagari.clusters.length, 0);
  assert.equal(onlyZagari.excluded[0].label, 'offering');
});

test('BBD: footnotes and remarks (re-read from EDGAR) name no plan or offering — the one-price rule is what takes it out', () => {
  const notes = F.cases.BBD.map((x) => [Object.values(x.raw?.fn || {}).join(' '), x.raw?.rm || ''].join(' ').trim());
  assert.ok(notes.every((t) => !/plan|offering|placement|issuer|remunerat|compensat/i.test(t)), 'the filings say nothing about how the shares were bought');
  assert.ok(F.cases.BBD.every((x) => x.row.fx?.lp === 17.98), 'every one of the 21 at exactly R$17.98');
  assert.ok(F.cases.BBD.every((x) => x.row.v >= CLUSTER.minPersonValue));
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
  const rows = [r('A', 'Shares purchased under the Employee Stock Purchase Plan.'), r('B', 'Purchased in the private placement directly from the issuer.'), r('C', 'Shares acquired through the dividend reinvestment plan.')];
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
    assert.deepEqual(home.map((x) => x[0]), ['RWT', 'PMTS', 'KRMN']);
    assert.deepEqual(teaser.signals.clusterExcluded.map((e) => [e.t, e.label]), [['TSM', 'plan_bulk'], ['BBD', 'program_same_price'], ['SBLK', 'offering']]);
  } finally {
    delete process.env.INSIDER_DATA_DIR;
    resetServedCache();
  }
});

test('a footnote about the holding ("Includes shares acquired through the dividend reinvestment plan") does not label the purchase', () => {
  const r = (n, note) => ({ t: 'X', k: 'P', r: 'director', n, d: '2026-09-10', p: 10, s: 2000, v: 20000, a: n, li: 0, note });
  const rows = [r('A', 'Includes shares acquired through dividend reinvestment plan.'), r('B', 'Includes 1,137 shares acquired pursuant to the Issuer\'s Employee Stock Purchase Plan.')];
  const labels = lineLabels(rows, (x) => ({ fn: { F1: x.note } }));
  assert.equal(labels.size, 0);
  assert.equal(buildClusters(rows, { rawOf: (x) => ({ fn: { F1: x.note } }) }).clusters.length, 1);
});

// ---------------------------------------------------------------------------
// "Toplu program alımı (dipnotsuz)": ≥5 countable people, one company, one
// day, one price (±0.1% of the median, or 0.01 of the currency)
import { SAME_PRICE_MIN_PEOPLE, SAME_PRICE_TOLERANCE, sameCohorts } from '../api/_lib/insiderCluster.js';
import { isForeignWith } from '../api/_lib/fpiContext.js';

const person = (n, d, p, extra = {}) => ({ t: 'SYN', ci: '1', k: 'P', r: 'director', n, d, p, s: Math.round(20000 / p) + 1, v: Math.round((Math.round(20000 / p) + 1) * p), a: `A-${n}-${d}`, li: 0, ...extra });
const people = (k, d, p) => Array.from({ length: k }, (_, i) => person(`P${i}`, d, p));

test('thresholds live in one place: 5 people, 0.1%', () => {
  assert.equal(SAME_PRICE_MIN_PEOPLE, 5);
  assert.equal(SAME_PRICE_TOLERANCE, 0.001);
});

test('BBD: 21 officers at exactly R$17.98 → "Toplu program alımı (dipnotsuz)", not a cluster', () => {
  const { clusters, excluded } = one('BBD');
  assert.equal(clusters.length, 0);
  const e = excluded.find((x) => x.t === 'BBD');
  assert.deepEqual([e.label, e.people, e.cu, e.price, e.maxDevPct, e.d], ['program_same_price', 21, 'BRL', 17.98, 0, '2026-09-18']);
  assert.ok(e.value > 5e6 && e.value < 5.3e6, `$${e.value}`);
});

test('5 people at one price → labelled; 4 → not, the cluster stays', () => {
  assert.equal(buildClusters(people(5, '2026-09-10', 12.5)).clusters.length, 0);
  assert.equal(buildClusters(people(5, '2026-09-10', 12.5)).excluded[0].label, 'program_same_price');
  const four = buildClusters(people(4, '2026-09-10', 12.5));
  assert.equal(four.clusters[0]?.insiders, 4);
  assert.equal(four.excluded.length, 0);
});

test('6 people 0.2% apart (±0.2% around the median) → not one price, the cluster stays', () => {
  const rows = [...people(3, '2026-09-10', 100).map((r) => ({ ...r })), ...people(3, '2026-09-10', 100.4).map((r) => ({ ...r, n: `Q${r.n}`, a: `B-${r.a}` }))];
  assert.equal(sameCohorts(rows).size, 0);
  assert.equal(buildClusters(rows).clusters[0]?.insiders, 6);
});

test('6 at one price + 2 others in the window on other days/prices → cohort out, a 2-person cluster stays', () => {
  const rows = [...people(6, '2026-09-10', 20), person('X', '2026-09-11', 21.3), person('Y', '2026-09-14', 22.1)];
  const { clusters, excluded } = buildClusters(rows);
  assert.equal(clusters[0].insiders, 2);
  assert.deepEqual(clusters[0].members.map((m) => m.n).sort(), ['X', 'Y']);
  assert.ok(clusters[0].others.every((o) => o.why === 'program_same_price'));
  assert.equal(excluded.length, 0, 'the company has a cluster: the cohort shows in its detail, not as a separate row');
});

test('6 at one price + 1 at another price the same day → cohort out, only one person left: no cluster', () => {
  const rows = [...people(6, '2026-09-10', 20), person('X', '2026-09-10', 20.9)];
  const { clusters, excluded } = buildClusters(rows);
  assert.equal(clusters.length, 0);
  assert.equal(excluded[0].label, 'program_same_price');
  assert.equal(excluded[0].people, 6);
});

test('compared in the form\'s currency: R$17.98 converted with rounding differences stays one cohort', () => {
  // the dollar prices differ in the fourth decimal (rounding of the
  // conversion), the reais price on the form is identical
  const rows = people(6, '2026-09-18', 3.4848).map((r, i) => ({ ...r, p: 3.4848 + i * 0.0001, fx: { ok: 1, cu: 'BRL', lp: 17.98, rate: 0.1938, ar: 1 } }));
  const m = sameCohorts(rows);
  assert.equal(m.size, 6);
  const [info] = [...m.values()];
  assert.deepEqual([info.cu, info.price, info.maxDevPct], ['BRL', 17.98, 0]);
  // …and a price is never converted twice: the cohort price is the form's
  assert.ok(rows.every((r) => r.p < 4), 'the rows keep their dollar price');
});

test('priority: offering > plan with a footnote > same-price program (TSM stays a plan, SBLK an offering)', () => {
  assert.equal(one('TSM').excluded[0].label, 'plan_bulk');
  assert.equal(one('SBLK').excluded[0].label, 'offering');
  // five buyers at one price whose footnotes name an ESPP: a plan, not a program
  const rows = people(5, '2026-09-10', 30);
  const labels = lineLabels(rows, () => ({ fn: { F1: 'Shares purchased under the Employee Stock Purchase Plan.' } }));
  assert.ok([...labels.values()].every((l) => l.label === 'plan_bulk'));
});

test('foreign private issuer flag: BBD, TSM, SBLK yes; RWT, GME, DKS no — from the SEC records', () => {
  const data = { issuers: Object.fromEntries(Object.values(F.issuers).filter((x) => x.record).map((x) => [x.cik, x.record])) };
  const isForeign = isForeignWith(data, Date.parse('2026-09-28'));
  const flags = Object.fromEntries(Object.entries(F.issuers).map(([t, x]) => [t, isForeign(x.cik)]));
  assert.deepEqual(flags, { BBD: true, TSM: true, SBLK: true, RWT: false, GME: false, DKS: false });
  // a 20-F/6-K older than 24 months does not make a company foreign
  const old = isForeignWith({ issuers: { 9: { fpi: 1, lf: '2024-01-15' } } }, Date.parse('2026-09-28'));
  assert.equal(old('9'), false);
  // the badge travels with the cluster and the look-alike, never the order
  const c = buildClusters(people(3, '2026-09-10', 40), { isForeign: () => true }).clusters[0];
  assert.equal(c.fpi, true);
  const e = buildClusters(people(5, '2026-09-10', 40), { isForeign: () => true }).excluded[0];
  assert.equal(e.fpi, true);
});

test('compensation shares are a plan purchase: fee program, retainer, in lieu of cash, Rule 16b-3 (Eastern Company)', () => {
  const day = { t: 'EML', d: '2026-09-16', f: '2026-09-17', k: 'P', r: 'director', p: 25.25 };
  const notes = {
    a: "1,217 shares issued under The Eastern Company Director's Fee Program pursuant to rule 16b-3(d). The price used to determine the number of shares is the price of the shares on September 15, 2026.",
    b: 'Shares received in lieu of cash for the quarterly board retainer.',
    c: 'Open market purchase.',
  };
  const lines = [
    { ...day, n: 'Galbato Chan', s: 1217, v: 30729, a: 'a', li: 0 },
    { ...day, n: 'Everets John', s: 1037, v: 26184, a: 'b', li: 0 },
    { ...day, n: 'Scott Peggy', s: 996, v: 25149, a: 'c', li: 0 },
  ];
  const labels = lineLabels(lines, (r) => ({ fn: { F1: notes[r.a] } }));
  assert.equal(labels.get(lines[0]).label, 'plan_bulk');
  assert.match(labels.get(lines[0]).quote, /Director's Fee Program/);
  assert.equal(labels.get(lines[1]).label, 'plan_bulk');
  assert.equal(labels.has(lines[2]), false, 'an open-market purchase is not labelled');
  // two fee-program directors do not make a cluster
  const cl = buildClusters(lines.slice(0, 2), { rawOf: (r) => ({ fn: { F1: notes[r.a] } }) });
  assert.equal(cl.byTicker.get('EML'), undefined);
});

test('"Includes shares acquired pursuant to the ESPP. Such acquisitions are exempt under Rule 16b-3." describes the holding, not the purchase (Matador)', () => {
  const r = { t: 'MTDR', d: '2026-08-10', f: '2026-08-11', k: 'P', r: 'officer', n: 'Elsener William Thomas', s: 850, p: 50.94, v: 43299, a: 'm', li: 0 };
  const labels = lineLabels([r], () => ({ fn: { F1: "Includes shares acquired pursuant to the Issuer's Employee Stock Purchase Plan. Such acquisitions are exempt under Rule 16b-3" } }));
  assert.equal(labels.has(r), false);
});
